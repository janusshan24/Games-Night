# Games Night: Master Project Brief (Version 1)

## What it is
A web app for a regular group of friends to run their games nights: who's coming, what's being played,
fair scoring, a nightly winner and a season-long league, with a clear process when someone is accused of cheating.

## Who uses it
| Role | Can do |
|---|---|
| **Player** | Sign up, edit own profile, RSVP, sign the fair-play declaration, propose games and house rules, vote, submit and approve scores, report incidents. |
| **Admin** | Everything a player can, plus manage players and roles, games, events, matches, finalise nights, issue or revoke penalties, change league settings, read the audit log. |

The first account created becomes the admin. The league always keeps at least one active admin.

## Version 1 features (30-prompt roadmap)
1. **Foundation**: brief, architecture, database, auth and roles, design system. *(this phase)*
2. **Core**: player management, no-cheating declaration, games library, AI rules agent, house rules, games-night sessions.
3. **Scoring**: individual scoring (high, low, win/loss, placement, rounds), teams and randomisation, score approval, timers and turns, random game picker.
4. **Competition**: nightly leaderboard, cumulative league table, manual end-of-night finalisation, history, disputes and penalties, stats and achievements.
5. **Admin**: notifications, admin dashboard, audit logs.
6. **Ship**: functional, security and mobile testing, deployment, final QA.

## Ground rules for every phase
1. **Build incrementally.** Extend this codebase; never start again from scratch.
2. **Preserve data.** Never delete games nights, scores or player records. Archive, void or supersede instead.
   The database enforces this: no history table allows DELETE.
3. **Stay consistent.** One Supabase database, one auth system, one permission model (`is_admin()` + row level security),
   one design system (`src/styles/tokens.css` + `src/components/ui.tsx`). Party-themed colours throughout.

## Completely free to run
| Need | Service | Free tier |
|---|---|---|
| Hosting | Vercel Hobby (or Netlify / Cloudflare Pages) | Free for personal, non-commercial use |
| Database, auth, realtime, file storage | Supabase Free | 500 MB database, 1 GB storage, 50k monthly users. Pauses after 7 days of no activity; one click to resume. |
| Code | GitHub | Free |
| Email for sign-up and reset | Supabase built-in | A few emails per hour, fine for a friend group |

No paid APIs are required for any feature.

## AI Rules Agent: the free approach
There is no permanently free, unlimited LLM API, so the rules agent is built in two layers:

* **Always on, zero cost:** each game stores an official rules link and summary. Anyone can propose a rules update
  with cited sources (`rule_proposals`); an admin approves it before it replaces the summary.
* **Optional AI research:** a Supabase Edge Function that calls an LLM with web search to find the current official
  rules and draft a proposal with citations. It only runs if an admin adds their own API key as a Supabase secret.
  Google's Gemini API has a free tier that should cover a friend group's usage; limits change, so check them when enabling.
  Without a key, the button simply isn't shown.

Either way, AI output is only ever a *proposal* with sources; a person approves it.
