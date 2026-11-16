import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { MatchData } from '../../hooks/useMatch'
import { SCORING_LABELS, type Profile } from '../../lib/types'
import { Alert, Avatar, Button, Card } from '../../components/ui'

interface Unit {
  key: string
  player_id: string | null
  team_id: string | null
  label: string
  color?: string | null
}

/** Players or teams being scored in this match. */
export function scoringUnits(data: MatchData, byId: Record<string, Profile>): Unit[] {
  if (data.match.is_team_game && data.teams.length) {
    return data.teams.map((t) => ({ key: t.id, player_id: null, team_id: t.id, label: t.name, color: t.color }))
  }
  return data.players.map((p) => ({ key: p.player_id, player_id: p.player_id, team_id: null, label: byId[p.player_id]?.display_name ?? '?' }))
}

/** Score entry that adapts to the game's scoring format. */
export function ScoreForm({ data, byId, onDone, onCancel }: { data: MatchData; byId: Record<string, Profile>; onDone: () => void; onCancel?: () => void }) {
  const type = data.match.scoring_type
  const units = scoringUnits(data, byId)
  const prev = (u: Unit) => data.entries.filter((e) => (u.team_id ? e.team_id === u.team_id : e.player_id === u.player_id))

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(units.map((u) => [u.key, String(prev(u).find((e) => e.round == null)?.value ?? '')])),
  )
  const [places, setPlaces] = useState<Record<string, string>>(() =>
    Object.fromEntries(units.map((u) => [u.key, String(prev(u)[0]?.placement ?? '')])),
  )
  const [winners, setWinners] = useState<Set<string>>(() => new Set(units.filter((u) => prev(u)[0]?.is_winner).map((u) => u.key)))
  const existingRounds = Math.max(1, ...data.entries.map((e) => e.round ?? 0))
  const [rounds, setRounds] = useState<Record<string, string>[]>(() =>
    Array.from({ length: existingRounds }, (_, i) =>
      Object.fromEntries(units.map((u) => [u.key, String(prev(u).find((e) => e.round === i + 1)?.value ?? '')])),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const roundTotal = (k: string) => rounds.reduce((s, r) => s + (Number(r[k]) || 0), 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const base = (u: Unit) => ({ player_id: u.player_id, team_id: u.team_id })
    let entries: Record<string, unknown>[] = []
    if (type === 'high_score' || type === 'low_score') {
      if (units.some((u) => values[u.key] === '' || Number.isNaN(Number(values[u.key])))) return setError('Enter a score for everyone.')
      entries = units.map((u) => ({ ...base(u), value: Number(values[u.key]) }))
    } else if (type === 'placement') {
      if (units.some((u) => !Number(places[u.key]))) return setError('Give everyone a finishing place.')
      entries = units.map((u) => ({ ...base(u), placement: Number(places[u.key]) }))
    } else if (type === 'win_loss') {
      if (winners.size === 0) return setError('Pick the winner.')
      entries = units.map((u) => ({ ...base(u), is_winner: winners.has(u.key) }))
    } else {
      entries = rounds.flatMap((r, i) => units.map((u) => ({ ...base(u), round: i + 1, value: Number(r[u.key]) || 0 })))
    }
    setBusy(true)
    const { error } = await supabase.rpc('submit_scores', { p_match: data.match.id, p_entries: entries })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  const name = (u: Unit) => (
    <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
      {u.player_id ? <Avatar id={u.player_id} name={u.label} size={28} /> : <span className="avatar" style={{ background: u.color ?? 'var(--primary)', width: 28, height: 28 }}>🤝</span>}
      {u.label}
    </span>
  )

  return (
    <Card title={`📝 Enter scores · ${SCORING_LABELS[type]}`} highlight>
      <form className="stack" onSubmit={submit}>
        {(type === 'high_score' || type === 'low_score') && (
          <table className="table">
            <tbody>
              {units.map((u) => (
                <tr key={u.key}>
                  <td>{name(u)}</td>
                  <td className="num">
                    <input className="input score-input" type="number" inputMode="decimal" step="any" value={values[u.key]} onChange={(e) => setValues({ ...values, [u.key]: e.target.value })} aria-label={`Score for ${u.label}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {type === 'placement' && (
          <table className="table">
            <tbody>
              {units.map((u) => (
                <tr key={u.key}>
                  <td>{name(u)}</td>
                  <td className="num">
                    <select className="select score-input" value={places[u.key]} onChange={(e) => setPlaces({ ...places, [u.key]: e.target.value })} aria-label={`Place for ${u.label}`}>
                      <option value="">–</option>
                      {units.map((_, i) => <option key={i} value={i + 1}>{ordinal(i + 1)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {type === 'win_loss' && (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="field__label">Who won? (tick more than one for a shared win)</span>
            {units.map((u) => (
              <label key={u.key} className="checkbox">
                <input
                  type="checkbox"
                  checked={winners.has(u.key)}
                  onChange={() => {
                    const n = new Set(winners)
                    if (n.has(u.key)) n.delete(u.key)
                    else n.add(u.key)
                    setWinners(n)
                  }}
                />
                {name(u)}
              </label>
            ))}
          </div>
        )}

        {type === 'rounds' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Round</th>
                  {units.map((u) => <th key={u.key} className="num">{u.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rounds.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {units.map((u) => (
                      <td key={u.key} className="num">
                        <input
                          className="input score-input"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={r[u.key]}
                          onChange={(e) => setRounds(rounds.map((x, j) => (j === i ? { ...x, [u.key]: e.target.value } : x)))}
                          aria-label={`Round ${i + 1} score for ${u.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  {units.map((u) => <td key={u.key} className="num"><strong>{roundTotal(u.key)}</strong></td>)}
                </tr>
              </tbody>
            </table>
            <Button type="button" size="sm" variant="secondary" onClick={() => setRounds([...rounds, Object.fromEntries(units.map((u) => [u.key, '']))])}>
              + Add round
            </Button>
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        <div className="row">
          <Button type="submit" variant="party" disabled={busy}>Submit for approval</Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
          Submitting ends the game. The other players confirm the scores before they count, and you can correct them until then.
        </p>
      </form>
    </Card>
  )
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
