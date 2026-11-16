# Architecture

```
Browser (React SPA on Vercel)
   │  supabase-js (one client: src/lib/supabase.ts)
   ▼
Supabase
   ├─ Auth (email + password, password reset)
   ├─ Postgres + row level security  ← all permissions live here
   ├─ Realtime (live scores / leaderboards, later phases)
   ├─ Storage (incident evidence photos, later phase)
   └─ Edge Functions (optional AI rules agent)
```

There is no custom backend server. The browser talks to Supabase directly and **row level security is the
security boundary**: hiding a button in the UI is convenience only.

## Frontend
* React 19 + TypeScript + Vite, React Router.
* `src/lib/`: Supabase client, row types, formatting helpers.
* `src/auth/`: `AuthProvider` (session + profile + `isAdmin`), route guards.
* `src/components/`: `AppShell` (desktop sidebar / mobile bottom tabs) and shared UI in `ui.tsx`.
* `src/styles/`: `tokens.css` (party palette, night and day themes), `components.css`.
* `src/pages/`: one file per screen. Features not built yet show a "coming in phase N" placeholder.

## Database (`supabase/migrations/`)
| Area | Tables |
|---|---|
| People | `profiles` (role: player/admin, is_active) |
| Settings | `league_settings` (points per placement, approvals needed) |
| Fair play | `declaration_versions`, `declarations` |
| Games & rules | `games`, `rule_proposals`, `house_rules`, `house_rule_votes` |
| Nights | `events`, `event_participants` |
| Play | `matches` (with turn order, round, timer), `teams`, `match_participants` |
| Scores | `score_entries` (pending → approved/disputed, corrections supersede), `score_approvals`, `match_results` (final, feeds leaderboards) |
| Accountability | `incidents`, `incident_votes`, `penalties` |
| Engagement | `achievements`, `player_achievements`, `notifications`, `notification_reads` |
| Audit | `audit_log` (written by triggers on every key table) |

Views: `nightly_leaderboard` (points per player per night) and `league_table` (all finalised nights, minus penalties).

### Permission model
* `public.is_admin()` is the single role check used by every policy.
* Everyone signed in can read league data.
* Players write only their own rows (profile, RSVP, declaration, votes, score approvals, incident reports) and can
  submit pending scores only for matches they're in.
* Admins insert and update everything else. **No DELETE** on history (only team setup before a match starts).
* Triggers stop players changing their own role and stop the last admin being removed.

## Hosting
* Vercel builds `npm run build` and serves `dist/`; `vercel.json` rewrites routes to `index.html`.
* Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the anon key is public by design; RLS protects data).
