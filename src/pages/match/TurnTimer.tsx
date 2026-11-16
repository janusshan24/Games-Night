import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { shuffle } from '../../lib/random'
import type { MatchData } from '../../hooks/useMatch'
import type { Profile } from '../../lib/types'
import { Alert, Avatar, Button, Card } from '../../components/ui'

const PRESETS = [30, 60, 120, 300]

function fmt(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Whose turn it is, the round, and a shared countdown timer. */
export function TurnTimer({ data, byId, onChange }: { data: MatchData; byId: Record<string, Profile>; onChange: () => void }) {
  const m = data.match
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!m.timer_started_at) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [m.timer_started_at])

  const remaining =
    m.timer_seconds == null
      ? null
      : m.timer_started_at
        ? Math.max(0, m.timer_seconds - (now - new Date(m.timer_started_at).getTime()) / 1000)
        : m.timer_seconds
  const running = Boolean(m.timer_started_at) && (remaining ?? 0) > 0
  const timeUp = Boolean(m.timer_started_at) && remaining === 0

  async function rpc(fn: string, args: Record<string, unknown>) {
    setError(null)
    const { error } = await supabase.rpc(fn, args)
    if (error) setError(error.message)
    onChange()
  }

  const current = m.current_turn_player ? byId[m.current_turn_player] : null
  const nextId = m.turn_order.length
    ? m.turn_order[((m.turn_order.indexOf(m.current_turn_player ?? '') + 1) % m.turn_order.length + m.turn_order.length) % m.turn_order.length]
    : null

  return (
    <div className="grid">
      <Card title={`🔄 Round ${Math.max(m.current_round, 1)}`} highlight>
        {error && <Alert tone="error">{error}</Alert>}
        {m.turn_order.length === 0 ? (
          <Button onClick={() => rpc('set_turn_order', { p_match: m.id, p_order: shuffle(data.players.map((p) => p.player_id)) })}>
            🎲 Random turn order
          </Button>
        ) : (
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            {current ? (
              <>
                <Avatar id={current.id} name={current.display_name} size={72} />
                <div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>It's your turn</div>
                  <h2 style={{ margin: 0 }}>{current.display_name}</h2>
                </div>
              </>
            ) : (
              <p className="muted">Tap “Next turn” to begin.</p>
            )}
            {nextId && current && <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Up next: {byId[nextId]?.display_name}</div>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button variant="secondary" size="sm" onClick={() => rpc('advance_turn', { p_match: m.id, p_step: -1 })} disabled={!current}>◀ Back</Button>
              <Button variant="party" onClick={() => rpc('advance_turn', { p_match: m.id, p_step: 1 })}>Next turn ▶</Button>
            </div>
            <div className="turn-order">
              {m.turn_order.map((pid) => (
                <span key={pid} className={pid === m.current_turn_player ? 'turn-order__item active' : 'turn-order__item'}>
                  {byId[pid]?.display_name}
                </span>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => rpc('set_turn_order', { p_match: m.id, p_order: shuffle(m.turn_order) })}>
              Shuffle order
            </Button>
          </div>
        )}
      </Card>

      <Card title="⏱️ Timer">
        <div className={timeUp ? 'timer timer--up' : 'timer'}>{remaining == null ? '–:––' : timeUp ? "Time's up!" : fmt(remaining)}</div>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 'var(--space-3)' }}>
          {PRESETS.map((s) => (
            <Button key={s} size="sm" variant={m.timer_seconds === s ? 'primary' : 'secondary'} onClick={() => rpc('set_timer', { p_match: m.id, p_seconds: s, p_running: false })}>
              {s < 60 ? `${s}s` : `${s / 60}m`}
            </Button>
          ))}
        </div>
        {m.timer_seconds != null && (
          <div className="row" style={{ justifyContent: 'center' }}>
            {running ? (
              <Button variant="secondary" onClick={() => rpc('set_timer', { p_match: m.id, p_seconds: Math.ceil(remaining ?? 0) || m.timer_seconds, p_running: false })}>⏸ Pause</Button>
            ) : (
              <Button onClick={() => rpc('set_timer', { p_match: m.id, p_seconds: timeUp ? m.timer_seconds : Math.max(5, Math.ceil(remaining ?? m.timer_seconds!)), p_running: true })}>▶ Start</Button>
            )}
            <Button variant="ghost" onClick={() => rpc('set_timer', { p_match: m.id, p_seconds: m.timer_seconds, p_running: true })}>↺ Restart</Button>
          </div>
        )}
        <p className="muted" style={{ fontSize: 'var(--text-xs)', textAlign: 'center', marginTop: 'var(--space-3)', marginBottom: 0 }}>
          The timer restarts each time the turn moves on. Everyone's phone shows the same clock.
        </p>
      </Card>
    </div>
  )
}
