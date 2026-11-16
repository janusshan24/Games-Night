-- =====================================================================
-- Phase 2: core games night features
-- =====================================================================

-- Rules agent: off by default. An admin turns it on after adding a
-- GEMINI_API_KEY secret to the rules-agent Edge Function.
alter table public.league_settings
  add column if not exists rules_agent_enabled boolean not null default false;

-- Per-player attendance and results summary for player profiles.
create or replace view public.player_stats with (security_invoker = true) as
select
  p.id                                                         as player_id,
  p.display_name,
  (select count(*) from public.event_participants ep
     join public.events e on e.id = ep.event_id
     where ep.player_id = p.id and ep.attended and e.status <> 'cancelled')::int   as nights_attended,
  (select count(*) from public.match_results r where r.player_id = p.id)::int       as games_played,
  (select count(*) from public.match_results r where r.player_id = p.id and r.is_winner)::int as wins,
  (select coalesce(sum(r.league_points), 0) from public.match_results r where r.player_id = p.id)::int as points,
  (select count(*) from public.penalties x where x.player_id = p.id and x.revoked_at is null)::int as penalties
from public.profiles p;

-- Whether a player has signed the current declaration.
create or replace function public.has_signed_current_declaration(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.declarations d
    join public.declaration_versions v on v.id = d.version_id and v.is_current
    where d.player_id = p_player
  );
$$;

-- A player can only be added to a match if they have signed the current
-- declaration (when the league requires it).
create or replace function public.guard_match_participant()
returns trigger language plpgsql as $$
begin
  if (select require_declaration from public.league_settings)
     and not public.has_signed_current_declaration(new.player_id) then
    raise exception 'This player must sign the fair play declaration before playing';
  end if;
  return new;
end $$;
create trigger match_participants_declaration
  before insert on public.match_participants
  for each row execute function public.guard_match_participant();

-- Audit the remaining Phase 2 tables.
create trigger event_participants_audit after insert or update or delete on public.event_participants
  for each row execute function public.write_audit();
create trigger match_participants_audit after insert or update or delete on public.match_participants
  for each row execute function public.write_audit();

-- Only admins (or the rules agent acting for an admin) can file AI-origin proposals.
drop policy if exists rule_proposals_player_insert on public.rule_proposals;
create policy rule_proposals_player_insert on public.rule_proposals for insert to authenticated
  with check (public.is_active_player() and proposed_by = auth.uid() and status = 'proposed' and origin = 'manual');
