import { useEffect, useRef, useState } from 'react'
import type { Game } from '../lib/types'
import { shuffle } from '../lib/random'
import { Button, Field } from './ui'

/** Random game generator with filters and a little drum-roll spin. */
export function GamePicker({
  games,
  defaultPlayers,
  exclude = [],
  onPick,
  pickLabel,
}: {
  games: Game[]
  defaultPlayers?: number
  exclude?: string[]
  onPick?: (g: Game) => void
  pickLabel?: string
}) {
  const [players, setPlayers] = useState(defaultPlayers ? String(defaultPlayers) : '')
  const [maxMinutes, setMaxMinutes] = useState('')
  const [teamsOnly, setTeamsOnly] = useState(false)
  const [skipPlayed, setSkipPlayed] = useState(exclude.length > 0)
  const [shown, setShown] = useState<Game | null>(null)
  const [spinning, setSpinning] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pool = games.filter((g) => {
    if (g.archived_at) return false
    const n = Number(players)
    if (n && (n < g.min_players || n > g.max_players)) return false
    if (Number(maxMinutes) && (g.estimated_minutes ?? 0) > Number(maxMinutes)) return false
    if (teamsOnly && !g.supports_teams) return false
    if (skipPlayed && exclude.includes(g.id)) return false
    return true
  })

  function spin() {
    if (pool.length === 0) return
    const order = shuffle(pool)
    const final = order[0]
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || pool.length === 1) {
      setShown(final)
      return
    }
    setSpinning(true)
    let i = 0
    let delay = 60
    const tick = () => {
      i++
      setShown(order[i % order.length])
      delay *= 1.15
      if (delay < 380) timer.current = window.setTimeout(tick, delay)
      else {
        setShown(final)
        setSpinning(false)
      }
    }
    tick()
  }

  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Field label="Players" type="number" min={1} value={players} onChange={(e) => setPlayers(e.target.value)} />
        <Field label="Max minutes" type="number" min={5} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} placeholder="Any" />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={teamsOnly} onChange={(e) => setTeamsOnly(e.target.checked)} />
        <span>Team games only</span>
      </label>
      {exclude.length > 0 && (
        <label className="checkbox">
          <input type="checkbox" checked={skipPlayed} onChange={(e) => setSkipPlayed(e.target.checked)} />
          <span>Skip games already played tonight</span>
        </label>
      )}
      <div className={spinning ? 'picker picker--spinning' : 'picker'} aria-live="polite">
        {shown ? (
          <>
            <div className="picker__name">{shown.name}</div>
            {!spinning && (
              <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {shown.min_players}–{shown.max_players} players{shown.estimated_minutes ? ` · ~${shown.estimated_minutes} min` : ''}
              </div>
            )}
          </>
        ) : (
          <div className="muted">{pool.length} game{pool.length === 1 ? '' : 's'} in the hat</div>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Button variant="party" onClick={spin} disabled={spinning || pool.length === 0}>
          🎰 {shown ? 'Spin again' : 'Spin'}
        </Button>
        {shown && !spinning && onPick && (
          <Button variant="secondary" onClick={() => onPick(shown)}>{pickLabel ?? 'Play this'}</Button>
        )}
      </div>
      {pool.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>No games fit those filters.</p>}
    </div>
  )
}
