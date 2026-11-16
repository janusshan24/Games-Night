import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { shuffle, TEAM_PRESETS } from '../../lib/random'
import type { MatchData } from '../../hooks/useMatch'
import type { Profile } from '../../lib/types'
import { Alert, Avatar, Button, Card, Select } from '../../components/ui'

/** Admin creates or randomises teams while the game is being set up. */
export function TeamSetup({ data, byId, canEdit, onChange }: { data: MatchData; byId: Record<string, Profile>; canEdit: boolean; onChange: () => void }) {
  const [count, setCount] = useState(Math.max(2, data.teams.length || 2))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxTeams = Math.max(2, Math.min(6, Math.floor(data.players.length / 1)))

  async function randomise() {
    setBusy(true)
    setError(null)
    try {
      const id = data.match.id
      // Clear old assignments (only allowed while setting up).
      let r = await supabase.from('match_participants').update({ team_id: null }).eq('match_id', id)
      if (r.error) throw r.error
      if (data.teams.length) {
        r = await supabase.from('teams').delete().eq('match_id', id)
        if (r.error) throw r.error
      }
      const presets = shuffle(TEAM_PRESETS).slice(0, count)
      const { data: teams, error } = await supabase
        .from('teams')
        .insert(presets.map((p) => ({ match_id: id, name: p.name, color: p.color })))
        .select('id')
      if (error) throw error
      const order = shuffle(data.players.map((p) => p.player_id))
      // Deal players round-robin so team sizes differ by at most one.
      await Promise.all(
        order.map((pid, i) =>
          supabase.from('match_participants').update({ team_id: teams[i % teams.length].id }).eq('match_id', id).eq('player_id', pid),
        ),
      )
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make teams')
    } finally {
      setBusy(false)
    }
  }

  async function move(playerId: string, teamId: string) {
    await supabase.from('match_participants').update({ team_id: teamId }).eq('match_id', data.match.id).eq('player_id', playerId)
    onChange()
  }

  return (
    <Card
      title="🤝 Teams"
      action={
        canEdit && (
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <select className="select" style={{ width: 'auto', minHeight: 34, padding: '4px 10px' }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of teams">
              {Array.from({ length: maxTeams - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} teams</option>)}
            </select>
            <Button size="sm" variant="party" onClick={randomise} disabled={busy}>🎲 {data.teams.length ? 'Re-shuffle' : 'Random teams'}</Button>
          </div>
        )
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {data.teams.length === 0 ? (
        <p className="muted">No teams yet. {canEdit ? 'Pick how many and shuffle.' : 'Waiting for the admin to make teams.'}</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {data.teams.map((t) => (
            <div key={t.id} className="team" style={{ ['--team' as string]: t.color ?? 'var(--primary)' }}>
              <div className="team__name">{t.name}</div>
              {data.players.filter((p) => p.team_id === t.id).map((p) => (
                <div key={p.player_id} className="row" style={{ gap: 'var(--space-2)', marginTop: 6, flexWrap: 'nowrap' }}>
                  <Avatar id={p.player_id} name={byId[p.player_id]?.display_name ?? '?'} size={26} />
                  <span style={{ flex: 1 }}>{byId[p.player_id]?.display_name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {canEdit && data.teams.length > 0 && data.players.some((p) => !p.team_id) && (
        <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
          {data.players.filter((p) => !p.team_id).map((p) => (
            <Select key={p.player_id} label={`Team for ${byId[p.player_id]?.display_name}`} value="" onChange={(e) => move(p.player_id, e.target.value)}>
              <option value="">Choose…</option>
              {data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          ))}
        </div>
      )}
    </Card>
  )
}
