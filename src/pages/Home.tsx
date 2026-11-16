import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatDateTime } from '../lib/format'
import type { GamesNight, LeagueRow } from '../lib/types'
import { Avatar, Badge, Card, Empty, Rank } from '../components/ui'

export function Home() {
  const { profile } = useAuth()
  const [nextNight, setNextNight] = useState<GamesNight | null>(null)
  const [top, setTop] = useState<LeagueRow[]>([])
  const [signed, setSigned] = useState<boolean | null>(null)

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const [night, league, version] = await Promise.all([
        supabase
          .from('events')
          .select('id,name,scheduled_at,location,status')
          .in('status', ['planned', 'live'])
          .order('scheduled_at')
          .limit(1)
          .maybeSingle(),
        supabase.from('league_table').select('*').order('total', { ascending: false }).limit(5),
        supabase.from('declaration_versions').select('id').eq('is_current', true).maybeSingle(),
      ])
      setNextNight((night.data as GamesNight | null) ?? null)
      setTop((league.data as LeagueRow[] | null) ?? [])
      if (version.data) {
        const { count } = await supabase
          .from('declarations')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', profile.id)
          .eq('version_id', version.data.id)
        setSigned((count ?? 0) > 0)
      }
    })()
  }, [profile])

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <header>
        <p className="muted" style={{ marginBottom: 4 }}>Hey {profile?.display_name ?? 'player'} 👋</p>
        <h1>
          Let's get this <span className="gradient-text">party</span> started
        </h1>
      </header>

      <div className="grid">
        <Card title="Next games night" highlight>
          {nextNight ? (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <div className="row">
                <h3 style={{ margin: 0 }}>{nextNight.name}</h3>
                {nextNight.status === 'live' ? <Badge tone="lime">● Live</Badge> : <Badge tone="cyan">Planned</Badge>}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {formatDateTime(nextNight.scheduled_at)}
                {nextNight.location && ` · ${nextNight.location}`}
              </p>
              <Link to={`/nights/${nextNight.id}`}>RSVP and details →</Link>
            </div>
          ) : (
            <Empty icon="🎉">No games night planned yet.</Empty>
          )}
        </Card>

        <Card title="Fair play declaration">
          {signed === null ? (
            <p className="muted">Checking…</p>
          ) : signed ? (
            <p>
              <Badge tone="lime">✓ Signed</Badge> You've signed the current declaration. <Link to="/declaration">View</Link>
            </p>
          ) : (
            <p>
              <Badge tone="gold">Needs signature</Badge> Sign the no-cheating declaration before your next game. <Link to="/declaration">Sign now →</Link>
            </p>
          )}
        </Card>
      </div>

      <Card title="League top 5" action={<Link to="/league">Full table →</Link>}>
        {top.length === 0 || top.every((r) => r.games_played === 0) ? (
          <Empty icon="🏆">No results yet. Scores appear once the first night is finalised.</Empty>
        ) : (
          <LeagueTable rows={top} />
        )}
      </Card>
    </div>
  )
}

export function LeagueTable({ rows }: { rows: LeagueRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th className="num">Played</th>
            <th className="num">Wins</th>
            <th className="num">Penalties</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.player_id}>
              <td><Rank n={i + 1} /></td>
              <td>
                <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                  <Avatar id={r.player_id} name={r.display_name} size={28} />
                  {r.display_name}
                </span>
              </td>
              <td className="num">{r.games_played}</td>
              <td className="num">{r.wins}</td>
              <td className="num">{r.penalty_points ? `−${r.penalty_points}` : '–'}</td>
              <td className="num"><strong>{r.total}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
