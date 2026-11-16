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
