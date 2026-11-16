import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useMatch } from '../../hooks/useMatch'
import { useProfiles } from '../../hooks/useProfiles'
import { SCORING_LABELS, type MatchStatus } from '../../lib/types'
import { Alert, Avatar, Badge, Button, Card, Rank } from '../../components/ui'
import { TeamSetup } from './TeamSetup'
import { TurnTimer } from './TurnTimer'
import { ScoreForm, ordinal } from './ScoreForm'
import { ScoreReview } from './ScoreReview'

export const MATCH_BADGE: Record<MatchStatus, { tone: 'lime' | 'cyan' | 'gold' | 'pink' | 'purple'; label: string }> = {
  setup: { tone: 'cyan', label: 'Setting up' },
  in_progress: { tone: 'lime', label: '● Playing' },
  scoring: { tone: 'gold', label: 'Checking scores' },
  completed: { tone: 'purple', label: 'Completed' },
  void: { tone: 'pink', label: 'Void' },
}

export function MatchDetail() {
  const { id } = useParams()
  const { profile, isAdmin } = useAuth()
  const { byId } = useProfiles()
  const { data, reload } = useMatch(id)
  const [scoring, setScoring] = useState(false)
  const [needed, setNeeded] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('league_settings').select('score_approvals_needed').maybeSingle().then(({ data }) => setNeeded(data?.score_approvals_needed ?? 1))
  }, [])

  if (!data || !profile) return <p className="muted">Loading…</p>
  const { match, game } = data
  const isPlayer = data.players.some((p) => p.player_id === profile.id)
  const canRun = isAdmin || isPlayer
  const teamName = (tid: string | null) => data.teams.find((t) => t.id === tid)

  async function setStatus(status: MatchStatus, extra: Record<string, unknown> = {}) {
    setError(null)
    const { error } = await supabase.from('matches').update({ status, ...extra }).eq('id', match.id)
    if (error) setError(error.message)
    reload()
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/nights/${match.event_id}`} className="muted">← Back to the night</Link>
        <div className="page-header" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
          <div>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <h1 style={{ margin: 0 }}>{game?.name ?? 'Game'}</h1>
              <Badge tone={MATCH_BADGE[match.status].tone}>{MATCH_BADGE[match.status].label}</Badge>
            </div>
            <p>
              {SCORING_LABELS[match.scoring_type]}
              {match.is_team_game && ' · team game'} · {data.players.length} players
              {game && <> · <Link to={`/games/${game.id}`}>rules</Link></>}
            </p>
          </div>
          {isAdmin && (
            <div className="row">
              {match.status === 'setup' && (
                <Button variant="party" disabled={match.is_team_game && data.teams.length === 0} onClick={() => setStatus('in_progress', { started_at: new Date().toISOString() })}>
                  ▶ Start game
                </Button>
              )}
              {match.status !== 'void' && match.status !== 'completed' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const reason = window.prompt('Why is this game void?')
                    if (reason) void setStatus('void', { void_reason: reason })
                  }}
                >
                  Void game
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {match.status === 'void' && <Alert tone="error">This game was voided: {match.void_reason}. It doesn't count towards any scores.</Alert>}

      {match.is_team_game && (match.status === 'setup' || data.teams.length > 0) && (
        <TeamSetup data={data} byId={byId} canEdit={isAdmin && match.status === 'setup'} onChange={reload} />
      )}

      {!match.is_team_game && match.status === 'setup' && (
        <Card title="👥 Players">
          <div className="row">
            {data.players.map((p) => (
              <span key={p.player_id} className="row" style={{ gap: 'var(--space-2)' }}>
                <Avatar id={p.player_id} name={byId[p.player_id]?.display_name ?? '?'} size={28} /> {byId[p.player_id]?.display_name}
              </span>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>Waiting for an admin to start the game.</p>
        </Card>
      )}

      {match.status === 'in_progress' && (
        <>
          <TurnTimer data={data} byId={byId} onChange={reload} />
          {canRun && !scoring && (
            <Button variant="party" block onClick={() => setScoring(true)}>🏁 Game over: enter scores</Button>
          )}
        </>
      )}

      {canRun && (scoring || (match.status === 'scoring' && data.entries.length === 0)) && (match.status === 'in_progress' || match.status === 'scoring') && (
        <ScoreForm data={data} byId={byId} onDone={() => { setScoring(false); reload() }} onCancel={() => setScoring(false)} />
      )}

      {match.status === 'scoring' && data.entries.length > 0 && !scoring && (
        <ScoreReview data={data} byId={byId} needed={needed} onEdit={() => setScoring(true)} onChange={reload} />
      )}

      {match.status === 'completed' && (
        <Card title="🏆 Final results" highlight>
          <table className="table">
            <thead>
              <tr>
                <th>Place</th>
                <th>Player</th>
                <th className="num">League points</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => {
                const t = teamName(r.team_id)
                return (
                  <tr key={r.player_id} className={r.is_winner ? 'winner-row' : undefined}>
                    <td><Rank n={r.placement} /> <span className="muted">{ordinal(r.placement)}</span></td>
                    <td>
                      <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                        <Avatar id={r.player_id} name={byId[r.player_id]?.display_name ?? '?'} size={28} />
                        {byId[r.player_id]?.display_name}
                        {t && <span className="badge" style={{ color: t.color ?? undefined }}>{t.name}</span>}
                      </span>
                    </td>
                    <td className="num"><strong>+{r.league_points}</strong></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
