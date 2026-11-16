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

**Phase 3 (games and scoring) done:** score entry for every format (highest, lowest, win/lose, finishing places,
points per round), random teams with team scoring, players approve or dispute scores before they count (admins can
settle disputes), live turn tracker and shared countdown timer, and a random game picker.

**Phase 4 (competition) done:** live nightly leaderboard, full league table with win rates, admin "End the night"
(locks results, voids unfinished games if chosen, awards achievements, announces the champion), history of past nights,
cheating reports with evidence links, group voting (the accused can't vote) and admin decisions with penalty points
that come off the league table, plus per-game records and winning streaks on player profiles.

**Phase 5 (notifications and admin) done:** automatic notifications (new nights, scores to check, results, house rule
votes, reports, achievements, rules updates) with a live bell and inbox, admin announcements, admin dashboard with a
"needs attention" list, versioned fair-play declaration editor (players re-sign), and a searchable audit log.

## Set up (about 15 minutes, all free, no coding)

You need two free accounts. Sign up to both with your GitHub account to keep it simple.

### 1. Create the database (Supabase)
1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub.
2. Click **New project**. Name it `Games Night`, click **Generate a password** (save it somewhere), pick the region closest to you, and click **Create new project**. Wait about 2 minutes.
3. In the left menu open **SQL Editor** → **New query**.
4. Open [`supabase/setup.sql`](supabase/setup.sql) here on GitHub, click the **Copy raw file** button, paste it into the Supabase editor and click **Run**. You should see *Success. No rows returned*.
5. Open **Project Settings** (gear icon) → **API** (may be called **Data API** / **API Keys**). Keep this tab open. You need two values:
   * **Project URL**, like `https://abcdefgh.supabase.co`
   * the **anon public** key (a long text starting `eyJ…`, or a **publishable** key starting `sb_publishable_…`). Never use the `service_role` / secret key.

### 2. Put the app online (Vercel)
1. Go to **https://vercel.com** → **Sign Up** → **Hobby** (free) → continue with GitHub.
2. Click **Add New… → Project**, find **Games-Night** and click **Import**. (If it isn't listed, click *Adjust GitHub App Permissions* and allow the repo.)
3. Open **Environment Variables** and add exactly these two:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |

4. Click **Deploy**. After about a minute you get a link like `https://games-night-xyz.vercel.app`.

### 3. Connect the two
1. Back in Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel link.
3. Under **Redirect URLs** click **Add URL** and add your Vercel link followed by `/**` (for example `https://games-night-xyz.vercel.app/**`). Save.

### 4. Play
Open your Vercel link and **Sign up**. Confirm the email Supabase sends you, then sign in.
**The first account becomes the admin.** Share the link with your friends so they can sign up as players.

### Updating later
New features arrive automatically on Vercel when code is pushed. If an update adds a file to
`supabase/migrations/`, run just that new file in the SQL Editor (the release notes will say which).

### Good to know about the free plan
* Supabase pauses a free project after 7 days with no activity. If the app stops loading, open supabase.com and click **Restore**.
* Supabase's built-in email sends only a few sign-up emails per hour, which is fine for a friend group.

### Running it on your own computer (developers only)
```bash
cp .env.example .env.local   # paste the same two values
npm install
npm run dev
```

## Optional: AI rules agent (free)
1. Get a free Gemini API key at https://aistudio.google.com/apikey.
2. With the Supabase CLI: `supabase secrets set GEMINI_API_KEY=your-key` then `supabase functions deploy rules-agent`.
3. In the app: Admin → League settings → tick "Show the AI rules agent button".

The agent only drafts a proposal with sources; an admin approves it. Without a key, everything else works.

## Scripts
`npm run dev` · `npm run build` · `npm run preview` · `npm run test:db` (database permission and scoring tests, no Supabase needed)
