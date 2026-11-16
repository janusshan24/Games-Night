-- =====================================================================
-- Phase 5: automatic notifications, declaration versions, admin tools
-- =====================================================================

create or replace function public._notify(p_recipient uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, kind, title, body, link, created_by)
  values (p_recipient, p_kind, p_title, p_body, p_link, auth.uid());
$$;
revoke execute on function public._notify(uuid, text, text, text, text) from public;

-- New games night planned → everyone.
create or replace function public.notify_event_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(null, 'announcement', '🎉 New games night: ' || new.name,
    to_char(new.scheduled_at at time zone 'UTC', 'Dy DD Mon') || coalesce(' at ' || new.location, '') || '. RSVP in the app.',
    '/nights/' || new.id);
  return new;
end $$;
create trigger events_notify after insert on public.events
  for each row execute function public.notify_event_created();

-- Match status changes → players in it / everyone.
create or replace function public.notify_match_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  game_name text;
  winners text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select name into game_name from public.games where id = new.game_id;

  if new.status = 'scoring' then
    insert into public.notifications (recipient_id, kind, title, body, link, created_by)
    select mp.player_id, 'score', '📝 Check the ' || game_name || ' scores',
           'Scores were entered. Approve them or raise a dispute.', '/matches/' || new.id, auth.uid()
    from public.match_participants mp
    where mp.match_id = new.id and mp.player_id is distinct from auth.uid();
  elsif new.status = 'completed' then
    select string_agg(p.display_name, ' & ' order by p.display_name) into winners
    from public.match_results r join public.profiles p on p.id = r.player_id
    where r.match_id = new.id and r.is_winner;
    perform public._notify(null, 'leaderboard', '🏆 ' || coalesce(winners, 'Someone') || ' won ' || game_name,
      'Scores approved. Tonight''s leaderboard has changed.', '/nights/' || new.event_id);
  end if;
  return new;
end $$;
create trigger matches_notify after update of status on public.matches
  for each row execute function public.notify_match_status();

-- New house rule or rules update → everyone (vote / review).
create or replace function public.notify_house_rule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._notify(null, 'rules', '🗳️ Vote on a house rule: ' || new.title, left(new.body, 140), '/rules');
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public._notify(null, 'rules', case when new.status = 'approved' then '✅ House rule approved: ' else '❌ House rule rejected: ' end || new.title,
      null, '/rules');
  end if;
  return new;
end $$;
create trigger house_rules_notify after insert or update of status on public.house_rules
  for each row execute function public.notify_house_rule();

create or replace function public.notify_rule_proposal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public._notify(null, 'rules', '📖 Rules updated: ' || (select name from public.games where id = new.game_id),
      'An admin approved new official rules.', '/games/' || new.game_id);
  end if;
  return new;
end $$;
create trigger rule_proposals_notify after update of status on public.rule_proposals
  for each row execute function public.notify_rule_proposal();

-- New report → everyone except the person it's about, plus a heads-up to them.
create or replace function public.notify_incident()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, kind, title, body, link, created_by)
  select p.id, 'incident', '⚖️ New report to vote on: ' || new.title, null, '/disputes', auth.uid()
  from public.profiles p
  where p.is_active and p.id is distinct from new.accused_id and p.id <> new.reported_by;
  if new.accused_id is not null then
    perform public._notify(new.accused_id, 'incident', '⚖️ A report mentions you',
      'You can read it and reply to the group. You can''t vote on it.', '/disputes');
  end if;
  return new;
end $$;
create trigger incidents_notify after insert on public.incidents
  for each row execute function public.notify_incident();

-- Achievements → the player.
create or replace function public.notify_achievement()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.achievements;
begin
  select * into a from public.achievements where code = new.achievement;
  perform public._notify(new.player_id, 'achievement', a.icon || ' Achievement unlocked: ' || a.name, a.description, '/players/' || new.player_id);
  return new;
end $$;
create trigger player_achievements_notify after insert on public.player_achievements
  for each row execute function public.notify_achievement();

-- Publish a new version of the fair play declaration. Everyone must re-sign.
create or replace function public.publish_declaration(p_title text, p_body text, p_penalty_terms text)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.is_admin() then raise exception 'Only admins can change the declaration'; end if;
  select coalesce(max(version), 0) + 1 into v from public.declaration_versions;
  update public.declaration_versions set is_current = false where is_current;
  insert into public.declaration_versions (version, title, body, penalty_terms, is_current, created_by)
  values (v, p_title, p_body, p_penalty_terms, true, auth.uid());
  perform public._notify(null, 'announcement', '✍️ Please re-sign the fair play declaration',
    'Version ' || v || ' has been published. You need to sign it before your next game.', '/declaration');
  return v;
end $$;

-- Mark every notification I can see as read.
create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = public as $$
  insert into public.notification_reads (notification_id, player_id)
  select n.id, auth.uid() from public.notifications n
  where n.recipient_id is null or n.recipient_id = auth.uid()
  on conflict do nothing;
$$;

-- Admin overview numbers in one call.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'players',          (select count(*) from public.profiles where is_active),
    'paused_players',   (select count(*) from public.profiles where not is_active),
    'unsigned_players', (select count(*) from public.profiles p where p.is_active and not public.has_signed_current_declaration(p.id)),
    'games',            (select count(*) from public.games where archived_at is null),
    'nights_finalised', (select count(*) from public.events where status = 'finalised'),
    'nights_upcoming',  (select count(*) from public.events where status in ('planned', 'live')),
    'matches_played',   (select count(*) from public.matches where status = 'completed'),
    'scores_waiting',   (select count(*) from public.matches where status = 'scoring'),
    'disputed_scores',  (select count(distinct match_id) from public.score_entries where status = 'disputed'),
    'open_reports',     (select count(*) from public.incidents where status in ('open', 'voting')),
    'house_rule_votes', (select count(*) from public.house_rules where status = 'proposed'),
    'rule_proposals',   (select count(*) from public.rule_proposals where status = 'proposed'),
    'audit_entries',    (select count(*) from public.audit_log)
  );
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
