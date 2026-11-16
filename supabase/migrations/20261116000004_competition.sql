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
