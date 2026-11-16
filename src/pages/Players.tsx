import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Avatar, Badge, Card, Empty, PageHeader } from '../components/ui'

interface PlayerStats {
  player_id: string
  display_name: string
  nights_attended: number
  games_played: number
  wins: number
  points: number
  penalties: number
}

export function Players() {
  const [players, setPlayers] = useState<Profile[]>([])
  const [stats, setStats] = useState<Record<string, PlayerStats>>({})

  useEffect(() => {
    void (async () => {
      const [p, s] = await Promise.all([
        supabase.from('profiles').select('*').eq('is_active', true).order('display_name'),
        supabase.from('player_stats').select('*'),
      ])
      setPlayers((p.data as Profile[] | null) ?? [])
      setStats(Object.fromEntries(((s.data as PlayerStats[] | null) ?? []).map((r) => [r.player_id, r])))
    })()
  }, [])

  return (
    <>
      <PageHeader title="Players" subtitle={`${players.length} in the league`} />
      <Card>
        {players.length === 0 ? (
          <Empty icon="👥">No players yet.</Empty>
        ) : (
          <div className="list">
            {players.map((p) => {
              const s = stats[p.id]
              return (
                <Link key={p.id} to={`/players/${p.id}`} className="list__item">
                  <Avatar id={p.id} name={p.display_name} size={44} />
                  <div className="list__main">
                    <div className="list__title">
                      {p.display_name} {p.role === 'admin' && <Badge tone="pink">admin</Badge>}
                    </div>
                    <div className="list__meta">
                      {s ? `${s.nights_attended} nights · ${s.games_played} games · ${s.wins} wins` : '—'}
                    </div>
                  </div>
                  <strong>{s?.points ?? 0} pts</strong>
                </Link>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}

interface Achievement {
  achievement: string
  earned_at: string
  achievements: { name: string; description: string; icon: string } | null
}

export function PlayerDetail() {
  const { id } = useParams()
  const [player, setPlayer] = useState<Profile | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [nights, setNights] = useState<{ event_id: string; attended: boolean; events: { name: string; scheduled_at: string } | null }[]>([])
  const [badges, setBadges] = useState<Achievement[]>([])
  const [signed, setSigned] = useState(false)
  const [perGame, setPerGame] = useState<{ game_id: string; game_name: string; played: number; wins: number; avg_place: number }[]>([])
  const [streaks, setStreaks] = useState({ best: 0, current: 0 })

  useEffect(() => {
    if (!id) return
    void (async () => {
      const [p, s, n, a, d, pg, fr] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('player_stats').select('*').eq('player_id', id).maybeSingle(),
        supabase.from('event_participants').select('event_id, attended, events(name, scheduled_at)').eq('player_id', id).eq('attended', true),
        supabase.from('player_achievements').select('achievement, earned_at, achievements(name, description, icon)').eq('player_id', id),
        supabase.rpc('has_signed_current_declaration', { p_player: id }),
        supabase.from('player_game_stats').select('*').eq('player_id', id).order('played', { ascending: false }),
        supabase.from('final_results').select('is_winner, recorded_at').eq('player_id', id).order('recorded_at'),
      ])
      setPerGame(pg.data ?? [])
      // Winning streaks across games in finalised nights.
      let best = 0
      let run = 0
      for (const r of (fr.data ?? []) as { is_winner: boolean }[]) {
        run = r.is_winner ? run + 1 : 0
        best = Math.max(best, run)
      }
      setStreaks({ best, current: run })
      setPlayer(p.data as Profile | null)
      setStats(s.data as PlayerStats | null)
      setNights((n.data as unknown as typeof nights | null) ?? [])
      setBadges((a.data as unknown as Achievement[] | null) ?? [])
      setSigned(Boolean(d.data))
    })()
  }, [id])

  if (!player) return <p className="muted">Loading…</p>
  const winRate = stats && stats.games_played ? Math.round((100 * stats.wins) / stats.games_played) : 0

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div className="row">
        <Avatar id={player.id} name={player.display_name} size={72} />
        <div>
          <h1 style={{ marginBottom: 4 }}>{player.display_name}</h1>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Badge tone={player.role === 'admin' ? 'pink' : 'cyan'}>{player.role}</Badge>
            {signed ? <Badge tone="lime">✓ Fair play signed</Badge> : <Badge tone="gold">Declaration not signed</Badge>}
          </div>
        </div>
      </div>
      {player.bio && <p className="muted">{player.bio}</p>}

      <div className="stats">
        <Stat label="Nights" value={stats?.nights_attended ?? 0} />
        <Stat label="Games" value={stats?.games_played ?? 0} />
        <Stat label="Wins" value={stats?.wins ?? 0} />
        <Stat label="Win rate" value={`${winRate}%`} />
        <Stat label="Points" value={stats?.points ?? 0} />
        <Stat label="Penalties" value={stats?.penalties ?? 0} />
        <Stat label="Best streak" value={`${streaks.best}🔥`} />
        <Stat label="Current streak" value={streaks.current} />
      </div>

      {perGame.length > 0 && (
        <Card title="🎲 Record by game">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th className="num">Played</th>
                  <th className="num">Wins</th>
                  <th className="num">Win rate</th>
                  <th className="num">Avg place</th>
                </tr>
              </thead>
              <tbody>
                {perGame.map((g) => (
                  <tr key={g.game_id}>
                    <td><Link to={`/games/${g.game_id}`}>{g.game_name}</Link></td>
                    <td className="num">{g.played}</td>
                    <td className="num">{g.wins}</td>
                    <td className="num">{Math.round((100 * g.wins) / g.played)}%</td>
                    <td className="num">{g.avg_place}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid">
        <Card title="Achievements">
          {badges.length === 0 ? (
            <Empty icon="🏅">None yet.</Empty>
          ) : (
            <div className="list">
              {badges.map((b) => (
                <div key={b.achievement} className="list__item">
                  <span style={{ fontSize: 28 }}>{b.achievements?.icon}</span>
                  <div className="list__main">
                    <div className="list__title">{b.achievements?.name}</div>
                    <div className="list__meta">{b.achievements?.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Attendance">
          {nights.length === 0 ? (
            <Empty icon="🎉">No nights attended yet.</Empty>
          ) : (
            <div className="list">
              {nights.map((n) => (
                <Link key={n.event_id} to={`/nights/${n.event_id}`} className="list__item">
                  <div className="list__main">
                    <div className="list__title">{n.events?.name}</div>
                    <div className="list__meta">{n.events && formatDateTime(n.events.scheduled_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}
