import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import type { MatchData } from '../../hooks/useMatch'
import type { Profile } from '../../lib/types'
import { Alert, Avatar, Badge, Button, Card, Field } from '../../components/ui'
import { scoringUnits } from './ScoreForm'

/** Shows the submitted scores and lets each player approve or dispute them. */
export function ScoreReview({ data, byId, needed, onEdit, onChange }: { data: MatchData; byId: Record<string, Profile>; needed: number; onEdit: () => void; onChange: () => void }) {
  const { profile, isAdmin } = useAuth()
  const [comment, setComment] = useState('')
  const [disputing, setDisputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const units = scoringUnits(data, byId)
  const type = data.match.scoring_type
  const submitter = data.entries[0]?.submitted_by
  const isPlayer = data.players.some((p) => p.player_id === profile?.id)

  // One decision per player (approvals are stored per score row).
  const decisions = new Map<string, { choice: string; comment: string | null }>()
  for (const a of data.approvals) decisions.set(a.player_id, { choice: a.choice, comment: a.comment })
  const approvers = [...decisions.entries()].filter(([pid, d]) => d.choice === 'approve' && pid !== submitter).length
  const disputes = [...decisions.entries()].filter(([, d]) => d.choice === 'dispute')
  const target = Math.min(needed, Math.max(data.players.length - 1, 0))
  const mine = profile ? decisions.get(profile.id) : undefined

  async function review(approve: boolean) {
    setError(null)
    const { error } = await supabase.rpc('review_scores', { p_match: data.match.id, p_approve: approve, p_comment: approve ? null : comment.trim() || null })
    if (error) setError(error.message)
    setDisputing(false)
    onChange()
  }
  async function settle() {
    const { error } = await supabase.rpc('admin_finalize_match', { p_match: data.match.id })
    if (error) setError(error.message)
    onChange()
  }

  const show = (u: (typeof units)[number]) => {
    const rows = data.entries.filter((e) => (u.team_id ? e.team_id === u.team_id : e.player_id === u.player_id))
    if (type === 'placement') return rows[0]?.placement ? `#${rows[0].placement}` : '–'
    if (type === 'win_loss') return rows[0]?.is_winner ? '🏆 Won' : 'Lost'
    return String(rows.reduce((s, r) => s + (Number(r.value) || 0), 0))
  }

  return (
    <Card
      title="✅ Check the scores"
      highlight
      action={disputes.length ? <Badge tone="pink">Disputed</Badge> : <Badge tone="gold">{approvers}/{target} approvals</Badge>}
    >
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        Entered by {submitter ? byId[submitter]?.display_name : 'someone'}. Needs {target} other player{target === 1 ? '' : 's'} to approve.
      </p>
      <table className="table" style={{ marginBottom: 'var(--space-4)' }}>
        <tbody>
          {units.map((u) => (
            <tr key={u.key}>
              <td>
                <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                  {u.player_id && <Avatar id={u.player_id} name={u.label} size={28} />}
                  {u.label}
                </span>
              </td>
              <td className="num"><strong>{show(u)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ marginBottom: 'var(--space-3)', gap: 'var(--space-2)' }}>
        {data.players.map((p) => {
          const d = decisions.get(p.player_id)
          const n = byId[p.player_id]?.display_name ?? '?'
          return (
            <Badge key={p.player_id} tone={d?.choice === 'approve' ? 'lime' : d?.choice === 'dispute' ? 'pink' : undefined}>
              {d?.choice === 'approve' ? '✓' : d?.choice === 'dispute' ? '✗' : '…'} {n}
            </Badge>
          )
        })}
      </div>
      {disputes.map(([pid, d]) =>
        d.comment ? (
          <Alert key={pid} tone="error">
            {byId[pid]?.display_name}: “{d.comment}”
          </Alert>
        ) : null,
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {isPlayer && (
        <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
          {disputing ? (
            <>
              <Field label="What's wrong?" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. I had 11 points, not 10" />
              <div className="row">
                <Button variant="danger" onClick={() => review(false)}>Dispute scores</Button>
                <Button variant="ghost" onClick={() => setDisputing(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div className="row">
              {mine?.choice !== 'approve' && <Button variant="party" onClick={() => review(true)}>👍 Scores are right</Button>}
              {mine?.choice !== 'dispute' && <Button variant="secondary" onClick={() => setDisputing(true)}>👎 Dispute</Button>}
              <Button variant="ghost" onClick={onEdit}>✏️ Correct scores</Button>
            </div>
          )}
        </div>
      )}
      {isAdmin && (
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <Button size="sm" variant="secondary" onClick={settle}>🛠️ Admin: confirm these scores now</Button>
          {!isPlayer && <Button size="sm" variant="ghost" onClick={onEdit}>✏️ Correct scores</Button>}
        </div>
      )}
    </Card>
  )
}
