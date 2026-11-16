-- Games Night: complete database setup. Paste this whole file into Supabase > SQL Editor and click Run, once.
-- Generated from supabase/migrations. Later updates come as small extra files to run afterwards.

-- ===== 20261116000001_foundation.sql =====
-- =====================================================================
-- Games Night: foundation schema (Version 1)
-- ---------------------------------------------------------------------
-- Principles
--   * One database, one auth system (Supabase Auth), one permission model.
--   * History is never deleted: there are no DELETE grants on historical
--     tables. Records are archived, voided or superseded instead.
--   * Every important change is written to audit_log by triggers.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role        as enum ('player', 'admin');
create type public.scoring_type    as enum ('high_score', 'low_score', 'win_loss', 'placement', 'rounds');
create type public.event_status    as enum ('planned', 'live', 'finalised', 'cancelled');
create type public.rsvp_status     as enum ('invited', 'going', 'maybe', 'declined');
create type public.match_status    as enum ('setup', 'in_progress', 'scoring', 'completed', 'void');
create type public.score_status    as enum ('pending', 'approved', 'disputed', 'superseded');
create type public.approval_choice as enum ('approve', 'dispute');
create type public.proposal_status as enum ('proposed', 'approved', 'rejected', 'retired');
create type public.incident_status as enum ('open', 'voting', 'upheld', 'dismissed');

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete restrict,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  avatar_url    text,
  role          public.app_role not null default 'player',
  is_active     boolean not null default true,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Role check used by every policy. SECURITY DEFINER so it can read
-- profiles without recursing through RLS.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_active_player()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

-- Create a profile for every new sign-up. The very first account becomes
-- the admin so a fresh install can be set up without touching SQL.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when first_user then 'admin'::public.app_role else 'player'::public.app_role end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Players may edit their own name, avatar and bio, but never their role
-- or active flag. Only admins change those.
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Only admins can change roles or deactivate players';
  end if;
  -- The league must always keep at least one active admin.
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
     and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'The league needs at least one active admin';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
-- League settings (single row)
-- ---------------------------------------------------------------------
create table public.league_settings (
  id                    boolean primary key default true check (id),
  league_name           text not null default 'Games Night League',
  placement_points      int[] not null default array[10, 7, 5, 3, 2],
  participation_points  int not null default 1,
  require_declaration   boolean not null default true,
  score_approvals_needed int not null default 1 check (score_approvals_needed >= 0),
  updated_at            timestamptz not null default now()
);
insert into public.league_settings default values;
create trigger league_settings_touch before update on public.league_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- No-cheating declaration (versioned text + signatures)
-- ---------------------------------------------------------------------
create table public.declaration_versions (
  id             uuid primary key default gen_random_uuid(),
  version        int not null unique,
  title          text not null,
  body           text not null,
  penalty_terms  text not null,
  is_current     boolean not null default false,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
create unique index declaration_versions_one_current
  on public.declaration_versions (is_current) where is_current;

-- ---------------------------------------------------------------------
-- Games library
-- ---------------------------------------------------------------------
create table public.games (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  category           text,
  min_players        int not null default 2 check (min_players >= 1),
  max_players        int not null default 8,
  estimated_minutes  int,
  scoring_type       public.scoring_type not null default 'placement',
  supports_teams     boolean not null default false,
  rules_summary      text,
  official_rules_url text,
  image_url          text,
  tags               text[] not null default '{}',
  archived_at        timestamptz,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (max_players >= min_players)
);
create unique index games_name_unique on public.games (lower(name)) where archived_at is null;
create trigger games_touch before update on public.games
  for each row execute function public.touch_updated_at();

-- Official rules updates proposed by the rules agent (or a person), with
-- cited sources. An admin approves before games.rules_summary changes.
create table public.rule_proposals (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games (id),
  proposed_text  text not null,
  sources        jsonb not null default '[]'::jsonb,  -- [{title, url, retrieved_at}]
  origin         text not null default 'manual' check (origin in ('manual', 'agent')),
  status         public.proposal_status not null default 'proposed',
  proposed_by    uuid references public.profiles (id),
  reviewed_by    uuid references public.profiles (id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- House rules: custom rules, voted on and approved.
create table public.house_rules (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid references public.games (id),   -- null = applies to every game
  title        text not null,
  body         text not null,
  status       public.proposal_status not null default 'proposed',
  proposed_by  uuid references public.profiles (id),
  decided_by   uuid references public.profiles (id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger house_rules_touch before update on public.house_rules
  for each row execute function public.touch_updated_at();

create table public.house_rule_votes (
  house_rule_id uuid not null references public.house_rules (id),
  voter_id      uuid not null references public.profiles (id),
  in_favour     boolean not null,
  voted_at      timestamptz not null default now(),
  primary key (house_rule_id, voter_id)
);

-- ---------------------------------------------------------------------
-- Games nights (events) and attendance
-- ---------------------------------------------------------------------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  scheduled_at  timestamptz not null,
  location      text,
  notes         text,
  status        public.event_status not null default 'planned',
  host_id       uuid references public.profiles (id),
  finalised_at  timestamptz,
  finalised_by  uuid references public.profiles (id),
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

create table public.event_participants (
  event_id      uuid not null references public.events (id),
  player_id     uuid not null references public.profiles (id),
  rsvp          public.rsvp_status not null default 'invited',
  attended      boolean not null default false,
  checked_in_at timestamptz,
  primary key (event_id, player_id)
);

create table public.declarations (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.profiles (id),
  version_id        uuid not null references public.declaration_versions (id),
  event_id          uuid references public.events (id),
  signature_name    text not null,
  accepts_penalties boolean not null check (accepts_penalties),
  user_agent        text,
  signed_at         timestamptz not null default now(),
  unique (player_id, version_id, event_id)
);

-- ---------------------------------------------------------------------
-- Matches (a game played during an event), teams and turns
-- ---------------------------------------------------------------------
create table public.matches (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events (id),
  game_id              uuid not null references public.games (id),
  status               public.match_status not null default 'setup',
  is_team_game         boolean not null default false,
  scoring_type         public.scoring_type not null,   -- copied from game at creation
  current_round        int not null default 0,
  current_turn_player  uuid references public.profiles (id),
  turn_order           uuid[] not null default '{}',
  timer_seconds        int,                            -- per-turn or match timer length
  timer_started_at     timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,
  void_reason          text,
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index matches_event_idx on public.matches (event_id);
create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

create table public.teams (
  id        uuid primary key default gen_random_uuid(),
  match_id  uuid not null references public.matches (id),
  name      text not null,
  color     text
);

create table public.match_participants (
  match_id   uuid not null references public.matches (id),
  player_id  uuid not null references public.profiles (id),
  team_id    uuid references public.teams (id),
  seat       int,
  primary key (match_id, player_id)
);

-- ---------------------------------------------------------------------
-- Scoring and approval
-- A score is submitted as 'pending', players approve or dispute it, and
-- a correction creates a new row and marks the old one 'superseded'.
-- ---------------------------------------------------------------------
create table public.score_entries (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.matches (id),
  player_id      uuid references public.profiles (id),
  team_id        uuid references public.teams (id),
  round          int,
  value          numeric,
  placement      int check (placement >= 1),
  is_winner      boolean,
  status         public.score_status not null default 'pending',
  supersedes_id  uuid references public.score_entries (id),
  submitted_by   uuid not null references public.profiles (id),
  submitted_at   timestamptz not null default now(),
  check ((player_id is not null) <> (team_id is not null))
);
create index score_entries_match_idx on public.score_entries (match_id);

create table public.score_approvals (
  score_entry_id uuid not null references public.score_entries (id),
  player_id      uuid not null references public.profiles (id),
  choice         public.approval_choice not null,
  comment        text,
  decided_at     timestamptz not null default now(),
  primary key (score_entry_id, player_id)
);

-- Final per-player outcome of a completed match. Written when the admin
-- finalises the night; this is what leaderboards read.
create table public.match_results (
  match_id        uuid not null references public.matches (id),
  player_id       uuid not null references public.profiles (id),
  team_id         uuid references public.teams (id),
  placement       int not null,
  league_points   int not null,
  is_winner       boolean not null default false,
  recorded_at     timestamptz not null default now(),
  primary key (match_id, player_id)
);

-- ---------------------------------------------------------------------
-- Cheating, disputes and penalties
-- ---------------------------------------------------------------------
create table public.incidents (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references public.events (id),
  match_id        uuid references public.matches (id),
  reported_by     uuid not null references public.profiles (id),
  accused_id      uuid references public.profiles (id),
  title           text not null,
  description     text not null,
  evidence        jsonb not null default '[]'::jsonb,   -- [{kind, url, note}]
  status          public.incident_status not null default 'open',
  proposed_penalty int,
  resolution      text,
  resolved_by     uuid references public.profiles (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger incidents_touch before update on public.incidents
  for each row execute function public.touch_updated_at();

create table public.incident_votes (
  incident_id  uuid not null references public.incidents (id),
  voter_id     uuid not null references public.profiles (id),
  uphold       boolean not null,
  comment      text,
  voted_at     timestamptz not null default now(),
  primary key (incident_id, voter_id)
);

create table public.penalties (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.profiles (id),
  event_id     uuid references public.events (id),
  incident_id  uuid references public.incidents (id),
  points       int not null check (points > 0),          -- deducted from league total
  reason       text not null,
  issued_by    uuid not null references public.profiles (id),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Achievements, notifications, audit log
-- ---------------------------------------------------------------------
create table public.achievements (
  code         text primary key,
  name         text not null,
  description  text not null,
  icon         text not null default '🏆'
);

create table public.player_achievements (
  player_id     uuid not null references public.profiles (id),
  achievement   text not null references public.achievements (code),
  event_id      uuid references public.events (id),
  earned_at     timestamptz not null default now(),
  primary key (player_id, achievement)
);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid references public.profiles (id),   -- null = everyone
  kind          text not null,                           -- announcement | score | leaderboard | incident | rules
  title         text not null,
  body          text,
  link          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id),
  player_id       uuid not null references public.profiles (id),
  read_at         timestamptz not null default now(),
  primary key (notification_id, player_id)
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  action       text not null,          -- INSERT | UPDATE | DELETE
  table_name   text not null,
  record_id    text,
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_table_idx on public.audit_log (table_name, created_at desc);

create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'match_id', rec ->> 'event_id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'league_settings', 'declaration_versions', 'games', 'rule_proposals',
    'house_rules', 'events', 'matches', 'score_entries', 'match_results',
    'incidents', 'penalties'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------
create or replace view public.nightly_leaderboard with (security_invoker = true) as
select
  m.event_id,
  r.player_id,
  p.display_name,
  sum(r.league_points)::int                          as points,
  count(*) filter (where r.is_winner)::int           as wins,
  count(*)::int                                      as games_played
from public.match_results r
join public.matches  m on m.id = r.match_id and m.status = 'completed'
join public.profiles p on p.id = r.player_id
group by m.event_id, r.player_id, p.display_name;

create or replace view public.league_table with (security_invoker = true) as
with totals as (
  select r.player_id,
         sum(r.league_points)::int                       as points,
         count(*) filter (where r.is_winner)::int        as wins,
         count(*)::int                                   as games_played,
         count(distinct m.event_id)::int                 as nights_played
  from public.match_results r
  join public.matches m on m.id = r.match_id and m.status = 'completed'
  join public.events  e on e.id = m.event_id and e.status = 'finalised'
  group by r.player_id
),
pens as (
  select player_id, sum(points)::int as penalty_points
  from public.penalties where revoked_at is null
  group by player_id
)
select
  p.id                                         as player_id,
  p.display_name,
  coalesce(t.points, 0)                        as points,
  coalesce(pens.penalty_points, 0)             as penalty_points,
  coalesce(t.points, 0) - coalesce(pens.penalty_points, 0) as total,
  coalesce(t.wins, 0)                          as wins,
  coalesce(t.games_played, 0)                  as games_played,
  coalesce(t.nights_played, 0)                 as nights_played,
  case when coalesce(t.games_played, 0) = 0 then 0
       else round(100.0 * t.wins / t.games_played, 1) end as win_rate
from public.profiles p
left join totals t   on t.player_id = p.id
left join pens       on pens.player_id = p.id
where p.is_active;

-- ---------------------------------------------------------------------
-- Row level security
-- Everyone signed in can read league data. Players write only their own
-- records; admins manage everything. No table grants DELETE on history.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'league_settings', 'declaration_versions', 'declarations', 'games',
    'rule_proposals', 'house_rules', 'house_rule_votes', 'events', 'event_participants',
    'matches', 'teams', 'match_participants', 'score_entries', 'score_approvals',
    'match_results', 'incidents', 'incident_votes', 'penalties', 'achievements',
    'player_achievements', 'notifications', 'notification_reads', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if t not in ('audit_log', 'notifications', 'notification_reads') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        t || '_read', t);
    end if;
  end loop;
end $$;

-- Admin write access to admin-managed tables (insert + update, no delete).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'league_settings', 'declaration_versions', 'games', 'rule_proposals',
    'house_rules', 'events', 'event_participants', 'matches', 'teams',
    'match_participants', 'score_entries', 'match_results', 'incidents',
    'penalties', 'achievements', 'player_achievements', 'notifications'
  ] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
      t || '_admin_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_update', t);
  end loop;
end $$;

-- Teams can be deleted while a match is still being set up (re-randomising).
create policy teams_admin_delete on public.teams for delete to authenticated
  using (public.is_admin() and exists (
    select 1 from public.matches m where m.id = match_id and m.status = 'setup'));
create policy match_participants_admin_delete on public.match_participants for delete to authenticated
  using (public.is_admin() and exists (
    select 1 from public.matches m where m.id = match_id and m.status = 'setup'));

-- Profiles: players edit their own (role changes blocked by trigger).
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Declarations: players sign for themselves only. Signatures are permanent.
create policy declarations_self_insert on public.declarations for insert to authenticated
  with check (player_id = auth.uid());

-- Attendance: players RSVP for themselves.
create policy event_participants_self_insert on public.event_participants for insert to authenticated
  with check (player_id = auth.uid());
create policy event_participants_self_update on public.event_participants for update to authenticated
  using (player_id = auth.uid()) with check (player_id = auth.uid());

-- Games, rules and house rules: any active player can propose.
create policy games_player_insert on public.games for insert to authenticated
  with check (public.is_active_player() and created_by = auth.uid());
create policy rule_proposals_player_insert on public.rule_proposals for insert to authenticated
  with check (public.is_active_player() and proposed_by = auth.uid() and status = 'proposed');
create policy house_rules_player_insert on public.house_rules for insert to authenticated
  with check (public.is_active_player() and proposed_by = auth.uid() and status = 'proposed');
create policy house_rule_votes_self on public.house_rule_votes for insert to authenticated
  with check (voter_id = auth.uid());
create policy house_rule_votes_self_update on public.house_rule_votes for update to authenticated
  using (voter_id = auth.uid()) with check (voter_id = auth.uid());

-- Scores: a participant in the match can submit a pending score.
create policy score_entries_participant_insert on public.score_entries for insert to authenticated
  with check (
    submitted_by = auth.uid() and status = 'pending' and exists (
      select 1 from public.match_participants mp
      where mp.match_id = score_entries.match_id and mp.player_id = auth.uid()));
create policy score_approvals_self on public.score_approvals for insert to authenticated
  with check (player_id = auth.uid() and exists (
    select 1 from public.score_entries s
    join public.match_participants mp on mp.match_id = s.match_id
    where s.id = score_entry_id and mp.player_id = auth.uid()));
create policy score_approvals_self_update on public.score_approvals for update to authenticated
  using (player_id = auth.uid()) with check (player_id = auth.uid());

-- Incidents: anyone can report and vote.
create policy incidents_player_insert on public.incidents for insert to authenticated
  with check (reported_by = auth.uid() and status = 'open');
create policy incident_votes_self on public.incident_votes for insert to authenticated
  with check (voter_id = auth.uid());

-- Notifications: see your own and broadcasts; mark your own as read.
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id is null or recipient_id = auth.uid() or public.is_admin());
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (player_id = auth.uid());
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (player_id = auth.uid());

-- Audit log: admins read; nobody writes directly (triggers only).
create policy audit_log_admin_read on public.audit_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
insert into public.declaration_versions (version, title, body, penalty_terms, is_current) values (
  1,
  'Games Night Fair Play Declaration',
  'I will play every game honestly and by the agreed rules and house rules. I will not look at hidden information, '
  'misreport scores, collude with other players, or knowingly break a rule to gain an advantage. If I am unsure of a '
  'rule I will ask before acting.',
  'If the group upholds a cheating report against me by vote, I accept the penalty the group agrees, which may include '
  'a points deduction from the league table, voiding of the affected game, or exclusion from the rest of the night.',
  true
);

insert into public.achievements (code, name, description, icon) values
  ('first_win',      'First Blood',      'Win your first game.',                         '🥇'),
  ('hat_trick',      'Hat-Trick',        'Win three games in a single night.',           '🎩'),
  ('night_champion', 'Champion of the Night', 'Top the nightly leaderboard.',            '👑'),
  ('ten_nights',     'Regular',          'Attend ten games nights.',                     '📅'),
  ('all_rounder',    'All-Rounder',      'Win at least five different games.',           '🎲'),
  ('clean_record',   'Clean Hands',      'Play ten nights with no upheld incidents.',    '🤝');

-- ===== 20261116000002_phase2.sql =====
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

-- ===== 20261116000003_scoring.sql =====
-- =====================================================================
-- Phase 3: scoring, teams, score approval, timers and turns
--
-- Score flow:
--   1. A player in the match (or an admin) submits the scores with
--      submit_scores(). Any earlier submission is marked 'superseded',
--      never deleted.
--   2. The other players approve or dispute with review_scores().
--   3. Once league_settings.score_approvals_needed players (other than
--      the submitter) approve and nobody disputes, the match completes and
--      match_results gets each player's place and league points.
--   4. An admin can settle a dispute with admin_finalize_match().
-- =====================================================================

create or replace function public.is_match_participant(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.match_participants where match_id = p_match and player_id = auth.uid());
$$;

create or replace function public._require_match_player(p_match uuid)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then raise exception 'Game not found'; end if;
  if not (public.is_admin() or public.is_match_participant(p_match)) then
    raise exception 'Only players in this game can do that';
  end if;
  return m;
end $$;

-- ---------------------------------------------------------------------
-- Turns and timers (any player in the match can run these)
-- ---------------------------------------------------------------------
create or replace function public.set_turn_order(p_match uuid, p_order uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  m := public._require_match_player(p_match);
  if m.status not in ('setup', 'in_progress') then raise exception 'This game is no longer being played'; end if;
  if (select count(*) from unnest(p_order) x where x not in
        (select player_id from public.match_participants where match_id = p_match)) > 0 then
    raise exception 'Turn order can only include players in this game';
  end if;
  update public.matches set turn_order = p_order, current_turn_player = null, current_round = 0 where id = p_match;
end $$;

create or replace function public.advance_turn(p_match uuid, p_step int default 1)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  n int;
  pos int;
  next_pos int;
  next_round int;
begin
  m := public._require_match_player(p_match);
  if m.status <> 'in_progress' then raise exception 'Start the game first'; end if;
  n := coalesce(array_length(m.turn_order, 1), 0);
  if n = 0 then raise exception 'Set a turn order first'; end if;
  pos := array_position(m.turn_order, m.current_turn_player);
  next_round := greatest(m.current_round, 1);
  if pos is null then
    next_pos := 1;
  else
    next_pos := pos + p_step;
    if next_pos > n then next_pos := 1; next_round := next_round + 1; end if;
    if next_pos < 1 then next_pos := n; next_round := greatest(next_round - 1, 1); end if;
  end if;
  update public.matches
     set current_turn_player = m.turn_order[next_pos],
         current_round = next_round,
         -- a running per-turn timer restarts for the next player
         timer_started_at = case when m.timer_started_at is not null then now() end
   where id = p_match;
end $$;

create or replace function public.set_timer(p_match uuid, p_seconds int, p_running boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_match_player(p_match);
  if p_seconds is not null and p_seconds not between 5 and 7200 then
    raise exception 'Timer must be between 5 seconds and 2 hours';
  end if;
  update public.matches
     set timer_seconds = p_seconds,
         timer_started_at = case when p_running and p_seconds is not null then now() end
   where id = p_match;
end $$;

-- ---------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------
create or replace function public.submit_scores(p_match uuid, p_entries jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  bad int;
begin
  m := public._require_match_player(p_match);
  if m.status not in ('in_progress', 'scoring') then
    raise exception 'Scores can only be entered while a game is being played or scored';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'No scores given';
  end if;

  select count(*) into bad
  from jsonb_to_recordset(p_entries) as x(player_id uuid, team_id uuid)
  where (x.player_id is not null and x.player_id not in (select player_id from public.match_participants where match_id = p_match))
     or (x.team_id is not null and x.team_id not in (select id from public.teams where match_id = p_match))
     or ((x.player_id is null) = (x.team_id is null));
  if bad > 0 then raise exception 'Scores must be for players or teams in this game'; end if;

  update public.score_entries set status = 'superseded'
   where match_id = p_match and status <> 'superseded';

  insert into public.score_entries (match_id, player_id, team_id, round, value, placement, is_winner, submitted_by, status)
  select p_match, x.player_id, x.team_id, x.round, x.value, x.placement, x.is_winner, auth.uid(), 'pending'
  from jsonb_to_recordset(p_entries)
       as x(player_id uuid, team_id uuid, round int, value numeric, placement int, is_winner boolean);

  update public.matches set status = 'scoring', ended_at = coalesce(ended_at, now()) where id = p_match;

  perform public._try_finalize_match(p_match);
end $$;

create or replace function public.review_scores(p_match uuid, p_approve boolean, p_comment text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not public.is_match_participant(p_match) then raise exception 'Only players in this game can review its scores'; end if;
  if m.status <> 'scoring' then raise exception 'There are no scores waiting for review'; end if;

  insert into public.score_approvals (score_entry_id, player_id, choice, comment)
  select id, auth.uid(), case when p_approve then 'approve' else 'dispute' end::public.approval_choice, p_comment
  from public.score_entries where match_id = p_match and status in ('pending', 'disputed')
  on conflict (score_entry_id, player_id)
  do update set choice = excluded.choice, comment = excluded.comment, decided_at = now();

  if not p_approve then
    update public.score_entries set status = 'disputed' where match_id = p_match and status = 'pending';
    return false;
  end if;
  return public._try_finalize_match(p_match);
end $$;

-- Completes the match when enough players approve and nobody disputes.
create or replace function public._try_finalize_match(p_match uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  needed int;
  players int;
  approvers int;
  disputes int;
begin
  select score_approvals_needed into needed from public.league_settings;
  select count(*) into players from public.match_participants where match_id = p_match;

  select count(distinct sa.player_id) filter (where sa.choice = 'approve' and sa.player_id <> se.submitted_by),
         count(*) filter (where sa.choice = 'dispute')
    into approvers, disputes
  from public.score_entries se
  join public.score_approvals sa on sa.score_entry_id = se.id
  where se.match_id = p_match and se.status <> 'superseded';

  -- Never ask for more approvals than there are other players.
  needed := least(needed, greatest(players - 1, 0));
  if disputes > 0 or approvers < needed then return false; end if;
  perform public._finalize_match(p_match);
  return true;
end $$;

-- Turns the current scores into places and league points.
create or replace function public._finalize_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  pts int[];
  part int;
begin
  select * into m from public.matches where id = p_match;
  select placement_points, participation_points into pts, part from public.league_settings;

  with units as (
    select se.team_id, se.player_id,
           sum(se.value)        as total,
           min(se.placement)    as placement,
           bool_or(se.is_winner) as winner
    from public.score_entries se
    where se.match_id = p_match and se.status <> 'superseded'
    group by se.team_id, se.player_id
  ),
  ranked as (
    select u.*,
           case m.scoring_type
             when 'high_score' then rank() over (order by u.total desc nulls last)
             when 'rounds'     then rank() over (order by u.total desc nulls last)
             when 'low_score'  then rank() over (order by u.total asc nulls last)
             when 'placement'  then coalesce(u.placement, 99)::bigint
             when 'win_loss'   then case when coalesce(u.winner, false) then 1 else 2 end::bigint
           end::int as rk
    from units u
  ),
  per_player as (
    select coalesce(r.player_id, mp.player_id) as player_id, r.team_id, r.rk
    from ranked r
    left join public.match_participants mp on r.team_id is not null and mp.match_id = p_match and mp.team_id = r.team_id
  )
  insert into public.match_results (match_id, player_id, team_id, placement, league_points, is_winner)
  select p_match, pp.player_id, pp.team_id, pp.rk,
         case when m.scoring_type = 'win_loss' and pp.rk > 1 then part
              else coalesce(pts[pp.rk], part) end,
         pp.rk = 1
  from per_player pp
  where pp.player_id is not null
  on conflict (match_id, player_id) do update
    set team_id = excluded.team_id, placement = excluded.placement,
        league_points = excluded.league_points, is_winner = excluded.is_winner, recorded_at = now();

  update public.score_entries set status = 'approved'
   where match_id = p_match and status <> 'superseded';
  update public.matches set status = 'completed', ended_at = coalesce(ended_at, now()) where id = p_match;
end $$;

-- An admin settles a disputed or stuck match using the current scores.
create or replace function public.admin_finalize_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can settle scores'; end if;
  if not exists (select 1 from public.score_entries where match_id = p_match and status <> 'superseded') then
    raise exception 'Enter scores first';
  end if;
  perform public._finalize_match(p_match);
end $$;

-- Internal helpers are not callable from the app.
revoke execute on function public._finalize_match(uuid) from public;
revoke execute on function public._try_finalize_match(uuid) from public;
revoke execute on function public._require_match_player(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public._finalize_match(uuid) from anon, authenticated';
    execute 'revoke execute on function public._try_finalize_match(uuid) from anon, authenticated';
    execute 'revoke execute on function public._require_match_player(uuid) from anon, authenticated';
  end if;
end $$;

-- Players in a match can read who approved what (already readable to all signed-in users).
create trigger score_approvals_audit after insert or update on public.score_approvals
  for each row execute function public.write_audit();
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------------
-- Live updates: phones at the table see turns, timers and scores change.
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.matches, public.score_entries, public.score_approvals;
  end if;
end $$;

-- ===== 20261116000004_competition.sql =====
-- =====================================================================
-- Phase 4: end-of-night finalisation, achievements, disputes, penalties
-- =====================================================================

-- Results that count: completed matches in finalised nights.
create or replace view public.final_results with (security_invoker = true) as
select r.*, m.event_id, m.game_id
from public.match_results r
join public.matches m on m.id = r.match_id and m.status = 'completed'
join public.events  e on e.id = m.event_id and e.status = 'finalised';

-- ---------------------------------------------------------------------
-- Achievements: (re)computed whenever a night is finalised.
-- ---------------------------------------------------------------------
create or replace function public._award_achievements(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Only completed matches in finalised nights count (see final_results).
  insert into public.player_achievements (player_id, achievement, event_id)
  select distinct player_id, 'first_win', p_event from public.final_results where is_winner
  on conflict do nothing;

  insert into public.player_achievements (player_id, achievement, event_id)
  select r.player_id, 'hat_trick', p_event
  from public.final_results r join public.matches m on m.id = r.match_id
  where m.event_id = p_event and r.is_winner
  group by r.player_id having count(*) >= 3
  on conflict do nothing;

  insert into public.player_achievements (player_id, achievement, event_id)
  select player_id, 'night_champion', p_event from (
    select player_id, rank() over (order by points desc) as rk
    from public.nightly_leaderboard where event_id = p_event
  ) x where rk = 1
  on conflict do nothing;

  insert into public.player_achievements (player_id, achievement, event_id)
  select r.player_id, 'all_rounder', p_event
  from public.final_results r join public.matches m on m.id = r.match_id
  where r.is_winner group by r.player_id having count(distinct m.game_id) >= 5
  on conflict do nothing;

  -- Nights played: attended or played at least one game.
  with nights as (
    select player_id, event_id from public.event_participants ep
      join public.events e on e.id = ep.event_id and e.status = 'finalised'
      where ep.attended
    union
    select r.player_id, m.event_id from public.final_results r join public.matches m on m.id = r.match_id
  ), counts as (
    select player_id, count(distinct event_id) as n from nights group by player_id
  )
  insert into public.player_achievements (player_id, achievement, event_id)
  select c.player_id, a.code, p_event
  from counts c
  cross join (values ('ten_nights'), ('clean_record')) as a(code)
  where c.n >= 10
    and (a.code = 'ten_nights' or not exists (
      select 1 from public.incidents i where i.accused_id = c.player_id and i.status = 'upheld'))
  on conflict do nothing;
end $$;
revoke execute on function public._award_achievements(uuid) from public;

-- ---------------------------------------------------------------------
-- Manual end-of-night: admin locks the results and archives the night.
-- ---------------------------------------------------------------------
create or replace function public.finalize_event(p_event uuid, p_void_unfinished boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.events;
  open_count int;
  champion text;
begin
  if not public.is_admin() then raise exception 'Only admins can finalise a games night'; end if;
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Games night not found'; end if;
  if e.status not in ('planned', 'live') then raise exception 'This night is already %', e.status; end if;

  select count(*) into open_count from public.matches
   where event_id = p_event and status in ('setup', 'in_progress', 'scoring');
  if open_count > 0 and not p_void_unfinished then
    raise exception '% game(s) still need scores. Finish them, or choose to void unfinished games.', open_count;
  end if;
  update public.matches set status = 'void', void_reason = 'Unfinished when the night was finalised'
   where event_id = p_event and status in ('setup', 'in_progress', 'scoring');

  update public.events set status = 'finalised', finalised_at = now(), finalised_by = auth.uid() where id = p_event;

  perform public._award_achievements(p_event);

  select string_agg(display_name, ' & ' order by display_name) into champion from (
    select display_name, rank() over (order by points desc) rk
    from public.nightly_leaderboard where event_id = p_event
  ) x where rk = 1;

  insert into public.notifications (kind, title, body, link, created_by)
  values ('leaderboard', e.name || ' is in the books 🎉',
          case when champion is null then 'Results are final.' else 'Champion of the night: ' || champion || '. The league table is updated.' end,
          '/nights/' || p_event, auth.uid());

  return jsonb_build_object('voided', open_count, 'champion', champion);
end $$;

-- ---------------------------------------------------------------------
-- Disputes and penalties
-- ---------------------------------------------------------------------
-- Players can change their vote, but the accused can't vote on their own case.
drop policy if exists incident_votes_self on public.incident_votes;
create policy incident_votes_self on public.incident_votes for insert to authenticated
  with check (voter_id = auth.uid() and not exists (
    select 1 from public.incidents i where i.id = incident_id and (i.accused_id = auth.uid() or i.status not in ('open', 'voting'))));
create policy incident_votes_self_update on public.incident_votes for update to authenticated
  using (voter_id = auth.uid()) with check (voter_id = auth.uid() and exists (
    select 1 from public.incidents i where i.id = incident_id and i.status in ('open', 'voting')));

-- The reporter can add evidence to their own open report.
create policy incidents_reporter_update on public.incidents for update to authenticated
  using (reported_by = auth.uid() and status in ('open', 'voting'))
  with check (reported_by = auth.uid() and status in ('open', 'voting'));

create or replace function public.resolve_incident(p_incident uuid, p_uphold boolean, p_penalty int, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  if not public.is_admin() then raise exception 'Only admins can resolve a report'; end if;
  select * into i from public.incidents where id = p_incident for update;
  if i.id is null then raise exception 'Report not found'; end if;
  if i.status not in ('open', 'voting') then raise exception 'This report is already resolved'; end if;
  if p_uphold and i.accused_id is null then raise exception 'Name who the report is about before upholding it'; end if;

  update public.incidents
     set status = case when p_uphold then 'upheld' else 'dismissed' end::public.incident_status,
         resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now(),
         proposed_penalty = coalesce(p_penalty, proposed_penalty)
   where id = p_incident;

  if p_uphold and coalesce(p_penalty, 0) > 0 then
    insert into public.penalties (player_id, event_id, incident_id, points, reason, issued_by)
    values (i.accused_id, i.event_id, i.id, p_penalty, coalesce(nullif(p_resolution, ''), i.title), auth.uid());
  end if;

  insert into public.notifications (kind, title, body, link, created_by)
  values ('incident', 'Report ' || case when p_uphold then 'upheld' else 'dismissed' end || ': ' || i.title,
          case when p_uphold and coalesce(p_penalty, 0) > 0 then p_penalty || ' point penalty applied.' else p_resolution end,
          '/disputes', auth.uid());
end $$;

create trigger incident_votes_audit after insert or update on public.incident_votes
  for each row execute function public.write_audit();

-- Per-game record for player profiles.
create or replace view public.player_game_stats with (security_invoker = true) as
select r.player_id, m.game_id, g.name as game_name,
       count(*)::int as played,
       count(*) filter (where r.is_winner)::int as wins,
       round(avg(r.placement), 1) as avg_place
from public.match_results r
join public.matches m on m.id = r.match_id and m.status = 'completed'
join public.games g on g.id = m.game_id
group by r.player_id, m.game_id, g.name;

-- ===== 20261116000005_notifications_admin.sql =====
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
