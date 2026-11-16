# 🎲 Games Night

Run your games nights: players, fair-play declarations, games and house rules, scoring with approval,
nightly and season leaderboards, disputes and penalties. Free to run on Supabase + Vercel.

See [docs/BRIEF.md](docs/BRIEF.md) for the product brief and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's built.

## Status
**Phase 1 (foundation) done:** full database schema with security rules, sign-up / sign-in / password reset,
player and admin roles, admin player management, party-themed responsive design system (desktop + iPhone + Android),
app shell, league table.

**Phase 2 (core features) done:** player profiles with stats and attendance, signing the no-cheating declaration
(players can't be added to a game until they've signed), games library with search and filters, rules updates with
cited sources and admin approval, optional AI rules agent, house rules with voting, and games nights with RSVP,
check-in and the games played that night.

## Set up (about 10 minutes, all free)
1. **Supabase**: create a free project at https://supabase.com.
   * SQL Editor → paste and run each file in `supabase/migrations/` in order (oldest first).
   * Authentication → URL Configuration → set Site URL to your app URL (e.g. `http://localhost:5173` while testing).
2. **Run locally**
   ```bash
   cp .env.example .env.local   # paste Project URL + anon key from Supabase → Project Settings → API
   npm install
   npm run dev
   ```
   Sign up. **The first account becomes the admin.**
3. **Deploy to Vercel (Hobby, free)**: import the GitHub repo, add the two `VITE_` variables, deploy.
   Then add the Vercel URL to Supabase's Site URL and Redirect URLs.

## Optional: AI rules agent (free)
1. Get a free Gemini API key at https://aistudio.google.com/apikey.
2. With the Supabase CLI: `supabase secrets set GEMINI_API_KEY=your-key` then `supabase functions deploy rules-agent`.
3. In the app: Admin → League settings → tick "Show the AI rules agent button".

The agent only drafts a proposal with sources; an admin approves it. Without a key, everything else works.

## Scripts
`npm run dev` · `npm run build` · `npm run preview`
