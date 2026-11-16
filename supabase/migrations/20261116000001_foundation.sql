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
