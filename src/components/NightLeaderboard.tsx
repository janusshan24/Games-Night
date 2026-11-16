import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar, Card, Empty, Rank } from './ui'

interface Row {
  player_id: string
  display_name: string
  points: number
  wins: number
  games_played: number
}

/** Rankings for one games night, from completed games. Updates live as scores are approved. */
export function NightLeaderboard({ eventId, finalised }: { eventId: string; finalised: boolean }) {
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    const load = () =>
      supabase
        .from('nightly_leaderboard')
        .select('*')
        .eq('event_id', eventId)
        .order('points', { ascending: false })
        .then(({ data }) => setRows((data as Row[] | null) ?? []))
    void load()
    if (finalised) return
    const ch = supabase
      .channel(`night-${eventId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `event_id=eq.${eventId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [eventId, finalised])

  // Standard competition ranking: ties share a place.
  const ranked = rows.map((r, i) => ({ ...r, rank: rows.findIndex((x) => x.points === r.points) + 1 || i + 1 }))

  return (
    <Card title={finalised ? '🏆 Final standings' : '📊 Tonight’s leaderboard'} highlight={finalised}>
      {ranked.length === 0 ? (
        <Empty icon="📊">Points appear here as games are scored and approved.</Empty>
      ) : (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="num hide-sm">Games</th>
              <th className="num">Wins</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.player_id} className={r.rank === 1 ? 'winner-row' : undefined}>
                <td><Rank n={r.rank} /></td>
                <td>
                  <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                    <Avatar id={r.player_id} name={r.display_name} size={28} />
                    <span>{r.display_name}{r.rank === 1 && (finalised ? ' 👑' : ' 🔥')}</span>
                  </span>
                </td>
                <td className="num hide-sm">{r.games_played}</td>
                <td className="num">{r.wins}</td>
                <td className="num"><strong>{r.points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </Card>
  )
}
