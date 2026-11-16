import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { GamesNight } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Badge, Card, Empty, PageHeader } from '../components/ui'

interface Summary {
  night: GamesNight
  champions: string[]
  games: number
  players: number
}

export function History() {
  const [items, setItems] = useState<Summary[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [n, lb, m] = await Promise.all([
        supabase.from('events').select('id,name,scheduled_at,location,status').in('status', ['finalised', 'cancelled']).order('scheduled_at', { ascending: false }),
        supabase.from('nightly_leaderboard').select('event_id, display_name, points'),
        supabase.from('matches').select('event_id').eq('status', 'completed'),
      ])
      const board = (lb.data ?? []) as { event_id: string; display_name: string; points: number }[]
      const matches = (m.data ?? []) as { event_id: string }[]
      setItems(
        ((n.data as GamesNight[] | null) ?? []).map((night) => {
          const rows = board.filter((r) => r.event_id === night.id)
          const top = Math.max(...rows.map((r) => r.points), 0)
          return {
            night,
            champions: rows.filter((r) => r.points === top && top > 0).map((r) => r.display_name),
            games: matches.filter((x) => x.event_id === night.id).length,
            players: rows.length,
          }
        }),
      )
    })()
  }, [])

  return (
    <>
      <PageHeader title="History" subtitle="Every past games night. Results are kept forever." />
      <Card>
        {items === null ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty icon="🗂️">No finished nights yet. An admin ends a night to add it here.</Empty>
        ) : (
          <div className="list">
            {items.map(({ night, champions, games, players }) => (
              <Link key={night.id} to={`/nights/${night.id}`} className="list__item">
                <span style={{ fontSize: 28 }}>{night.status === 'cancelled' ? '🚫' : '🏆'}</span>
                <div className="list__main">
                  <div className="list__title">{night.name}</div>
                  <div className="list__meta">
                    {formatDateTime(night.scheduled_at)}
                    {night.status === 'finalised' && ` · ${games} games · ${players} players`}
                  </div>
                </div>
                {night.status === 'cancelled' ? (
                  <Badge tone="pink">Cancelled</Badge>
                ) : champions.length ? (
                  <Badge tone="gold">👑 {champions.join(' & ')}</Badge>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
