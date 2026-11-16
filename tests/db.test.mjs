// Database tests: run every migration in an in-memory Postgres (PGlite) and
// check permissions, scoring and league maths. Run with: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const dir = new URL('../supabase/migrations/', import.meta.url)
const db = new PGlite()

// Minimal stand-in for Supabase's auth schema and roles.
await db.exec(`
  create role authenticated; create role anon; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;`)
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'))
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
               grant select on all tables in schema public to authenticated;`)

const [ADMIN, BOB, CAT, DAN] = ['a', 'b', 'c', 'd'].map((x) => `${x.repeat(8)}-0000-0000-0000-000000000000`)
await db.exec(`insert into auth.users values
  ('${ADMIN}','admin@x','{"display_name":"Ada"}'), ('${BOB}','bob@x','{}'),
  ('${CAT}','cat@x','{}'), ('${DAN}','dan@x','{}');
  set role authenticated;`)

const as = (u) => db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`)
const q = async (sql) => (await db.query(sql)).rows
const one = async (sql) => (await q(sql))[0]
const fails = async (sql, re) => {
  await assert.rejects(db.query(sql), re)
}

test('first account becomes admin, the rest are players', async () => {
  await as(ADMIN)
  const rows = await q(`select id, role from profiles order by id`)
  assert.equal(rows.find((r) => r.id === ADMIN).role, 'admin')
  assert.equal(rows.find((r) => r.id === BOB).role, 'player')
})

test('players cannot promote themselves, delete history or read the audit log', async () => {
  await as(BOB)
  await fails(`update profiles set role='admin' where id='${BOB}'`, /Only admins/)
  assert.equal((await q(`delete from profiles where id='${ADMIN}' returning id`)).length, 0)
  assert.equal((await one(`select count(*)::int n from audit_log`)).n, 0)
  await fails(`insert into events(name, scheduled_at) values ('x', now())`, /row-level security/)
})

test('the last admin cannot be removed', async () => {
  await as(ADMIN)
  await fails(`update profiles set role='player' where id='${ADMIN}'`, /at least one active admin/)
})

test('players must sign the declaration before they can play', async () => {
  await as(ADMIN)
  await q(`insert into events(name, scheduled_at, status) values ('Night 1', now(), 'live')`)
  await q(`insert into games(name, scoring_type) values ('Uno','placement')`)
  const m = await one(`insert into matches(event_id, game_id, scoring_type, status)
    select e.id, g.id, 'placement', 'in_progress' from events e, games g returning id`)
  await fails(`insert into match_participants(match_id, player_id) values ('${m.id}','${BOB}')`, /sign the fair play/)
  for (const u of [ADMIN, BOB, CAT, DAN]) {
    await as(u)
    await q(`insert into declarations(player_id, version_id, signature_name, accepts_penalties)
             select '${u}', id, 'Me', true from declaration_versions where is_current`)
  }
  await as(BOB)
  await fails(`insert into declarations(player_id, version_id, signature_name, accepts_penalties)
               select '${CAT}', id, 'Cat', true from declaration_versions where is_current`, /row-level security/)
})

test('scores need approval from other players and award league points', async () => {
  await as(ADMIN)
  await q(`update league_settings set score_approvals_needed = 2`)
  const m = await one(`select id from matches limit 1`)
  await q(`insert into match_participants(match_id, player_id) values ('${m.id}','${ADMIN}'),('${m.id}','${BOB}'),('${m.id}','${CAT}')`)
  await as(DAN)
  await fails(`select submit_scores('${m.id}', '[]')`, /Only players in this game/)
  await as(BOB)
  await q(`select submit_scores('${m.id}', '[{"player_id":"${BOB}","placement":1},{"player_id":"${ADMIN}","placement":2},{"player_id":"${CAT}","placement":3}]')`)
  await q(`select review_scores('${m.id}', true)`) // own approval doesn't count
  assert.equal((await one(`select status from matches where id='${m.id}'`)).status, 'scoring')
  await as(CAT)
  await q(`select review_scores('${m.id}', false, 'wrong')`)
  await as(BOB) // corrected submission supersedes the old one
  await q(`select submit_scores('${m.id}', '[{"player_id":"${BOB}","placement":1},{"player_id":"${CAT}","placement":2},{"player_id":"${ADMIN}","placement":3}]')`)
  await as(CAT)
  await q(`select review_scores('${m.id}', true)`)
  await as(ADMIN)
  assert.equal(await one(`select review_scores('${m.id}', true) as done`).then((r) => r.done), true)
  const res = await q(`select player_id, placement, league_points from match_results where match_id='${m.id}' order by placement`)
  assert.deepEqual(res.map((r) => [r.player_id, r.league_points]), [[BOB, 10], [CAT, 7], [ADMIN, 5]])
  assert.equal((await one(`select count(*)::int n from score_entries where status='superseded'`)).n, 3)
})

test('internal scoring helpers cannot be called directly', async () => {
  await as(BOB)
  await fails(`select _finalize_match(gen_random_uuid())`, /permission denied/)
})

test('team games give every team member the team result', async () => {
  await as(ADMIN)
  const m = await one(`insert into matches(event_id, game_id, scoring_type, status, is_team_game)
    select e.id, g.id, 'win_loss', 'in_progress', true from events e, games g returning id`)
  const [red, blue] = (await q(`insert into teams(match_id, name) values ('${m.id}','Red'),('${m.id}','Blue') returning id`)).map((r) => r.id)
  await q(`insert into match_participants(match_id, player_id, team_id) values
    ('${m.id}','${ADMIN}','${red}'),('${m.id}','${BOB}','${red}'),('${m.id}','${CAT}','${blue}'),('${m.id}','${DAN}','${blue}')`)
  await q(`select submit_scores('${m.id}', '[{"team_id":"${red}","is_winner":true},{"team_id":"${blue}","is_winner":false}]')`)
  await as(CAT)
  await fails(`select admin_finalize_match('${m.id}')`, /Only admins/)
  await as(ADMIN)
  await q(`select admin_finalize_match('${m.id}')`)
  const res = await q(`select player_id, league_points, is_winner from match_results where match_id='${m.id}' order by player_id`)
  assert.deepEqual(res.map((r) => [r.player_id, r.league_points, r.is_winner]), [
    [ADMIN, 10, true], [BOB, 10, true], [CAT, 1, false], [DAN, 1, false],
  ])
})

test('ending the night locks results, awards achievements and fills the league table', async () => {
  await as(BOB)
  const ev = await one(`select id from events limit 1`)
  await fails(`select finalize_event('${ev.id}')`, /Only admins/)
  await as(ADMIN)
  await q(`select finalize_event('${ev.id}')`)
  assert.equal((await one(`select status from events where id='${ev.id}'`)).status, 'finalised')
  const league = await q(`select player_id, total from league_table order by total desc, player_id`)
  assert.deepEqual(league.map((r) => [r.player_id, r.total]), [[ADMIN, 15], [BOB, 20], [CAT, 8], [DAN, 1]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  const ach = await q(`select achievement from player_achievements where player_id='${BOB}' order by 1`)
  assert.deepEqual(ach.map((r) => r.achievement), ['first_win', 'night_champion'])
})

test('reports: the accused cannot vote, only admins decide, penalties reduce the league total', async () => {
  await as(CAT)
  const inc = await one(`insert into incidents(reported_by, accused_id, title, description) values ('${CAT}','${BOB}','Peeked','...') returning id`)
  await as(BOB)
  await fails(`insert into incident_votes(incident_id, voter_id, uphold) values ('${inc.id}','${BOB}',false)`, /row-level security/)
  await fails(`select resolve_incident('${inc.id}', false, 0, 'no')`, /Only admins/)
  await as(ADMIN)
  await q(`select resolve_incident('${inc.id}', true, 4, 'Peeking')`)
  assert.equal((await one(`select total from league_table where player_id='${BOB}'`)).total, 16)
})

test('notifications: players only see their own and broadcasts, only admins announce', async () => {
  await as(BOB)
  const others = await one(`select count(*)::int n from notifications where recipient_id is not null and recipient_id <> '${BOB}'`)
  assert.equal(others.n, 0)
  await fails(`insert into notifications(kind, title) values ('announcement','hi')`, /row-level security/)
  await q(`select mark_all_notifications_read()`)
  const unread = await one(`select count(*)::int n from notifications n where not exists
    (select 1 from notification_reads r where r.notification_id = n.id and r.player_id = '${BOB}')`)
  assert.equal(unread.n, 0)
})
