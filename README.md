# 🎲 Games Night

Run your games nights: players, fair-play declarations, games and house rules, scoring with approval,
nightly and season leaderboards, disputes and penalties. Free to run on Supabase + Vercel.

See [docs/BRIEF.md](docs/BRIEF.md) for the product brief and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's built.

## Status
**Phase 1 (foundation) done:** full database schema with security rules, sign-up / sign-in / password reset,
player and admin roles, admin player management, party-themed responsive design system (desktop + iPhone + Android),
app shell, league table.

## Set up (about 10 minutes, all free)
1. **Supabase**: create a free project at https://supabase.com.
   * SQL Editor → paste and run `supabase/migrations/20261116000001_foundation.sql`.
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

## Scripts
`npm run dev` · `npm run build` · `npm run preview`
