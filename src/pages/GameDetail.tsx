import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProfiles } from '../hooks/useProfiles'
import { SCORING_LABELS, type Game, type HouseRule, type RuleProposal, type RuleSource } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Alert, Badge, Button, Card, Empty, Modal, TextArea } from '../components/ui'
import { GameForm } from './Games'

export function GameDetail() {
  const { id } = useParams()
  const { profile, isAdmin } = useAuth()
  const { byId } = useProfiles()
  const [game, setGame] = useState<Game | null>(null)
  const [proposals, setProposals] = useState<RuleProposal[]>([])
  const [houseRules, setHouseRules] = useState<HouseRule[]>([])
  const [agentEnabled, setAgentEnabled] = useState(false)
  const [editing, setEditing] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [g, p, h, s] = await Promise.all([
      supabase.from('games').select('*').eq('id', id).maybeSingle(),
      supabase.from('rule_proposals').select('*').eq('game_id', id).order('created_at', { ascending: false }),
      supabase.from('house_rules').select('*').eq('game_id', id).eq('status', 'approved'),
      supabase.from('league_settings').select('rules_agent_enabled').maybeSingle(),
    ])
    setGame(g.data as Game | null)
    setProposals((p.data as RuleProposal[] | null) ?? [])
    setHouseRules((h.data as HouseRule[] | null) ?? [])
    setAgentEnabled(Boolean(s.data?.rules_agent_enabled))
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  if (!game) return <p className="muted">Loading…</p>

  async function setArchived(archived: boolean) {
    const { error } = await supabase.from('games').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', game!.id)
    setMsg(error ? { tone: 'error', text: error.message } : null)
    await load()
  }

  async function decide(p: RuleProposal, approve: boolean) {
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('rule_proposals')
      .update({ status: approve ? 'approved' : 'rejected', reviewed_by: profile?.id, reviewed_at: now })
      .eq('id', p.id)
    if (!error && approve) {
      const sourceUrl = p.sources[0]?.url
      await supabase
        .from('games')
        .update({ rules_summary: p.proposed_text, ...(sourceUrl && !game!.official_rules_url ? { official_rules_url: sourceUrl } : {}) })
        .eq('id', game!.id)
    }
    setMsg(error ? { tone: 'error', text: error.message } : { tone: 'success', text: approve ? 'Rules updated.' : 'Proposal rejected.' })
    await load()
  }

  async function runAgent() {
    setAgentBusy(true)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('rules-agent', { body: { game_id: game!.id } })
    setAgentBusy(false)
    if (error || data?.error) setMsg({ tone: 'error', text: data?.error ?? error?.message ?? 'The rules agent failed.' })
    else setMsg({ tone: 'success', text: 'The rules agent drafted a proposal with sources. Review it below.' })
    await load()
  }

  const pending = proposals.filter((p) => p.status === 'proposed')
  const past = proposals.filter((p) => p.status !== 'proposed')

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div>
        <Link to="/games" className="muted">← Games library</Link>
        <div className="page-header" style={{ marginTop: 'var(--space-2)' }}>
          <div>
            <h1>{game.name}</h1>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <Badge tone="cyan">{game.min_players}–{game.max_players} players</Badge>
              {game.estimated_minutes && <Badge tone="gold">~{game.estimated_minutes} min</Badge>}
              <Badge tone="purple">{SCORING_LABELS[game.scoring_type]}</Badge>
              {game.supports_teams && <Badge tone="lime">Teams</Badge>}
              {game.category && <Badge>{game.category}</Badge>}
              {game.archived_at && <Badge tone="pink">Archived</Badge>}
            </div>
          </div>
          {isAdmin && (
            <div className="row">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => setArchived(!game.archived_at)}>
                {game.archived_at ? 'Restore' : 'Archive'}
              </Button>
            </div>
          )}
        </div>
        {game.description && <p className="muted">{game.description}</p>}
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card
        title="📖 Official rules"
        highlight
        action={
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            {isAdmin && agentEnabled && (
              <Button size="sm" variant="party" onClick={runAgent} disabled={agentBusy}>
                {agentBusy ? 'Researching…' : '✨ Research with AI'}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setProposing(true)}>Propose update</Button>
          </div>
        }
      >
        {game.rules_summary ? <p className="prose">{game.rules_summary}</p> : <Empty icon="📖">No rules summary yet.</Empty>}
        {game.official_rules_url && (
          <a href={game.official_rules_url} target="_blank" rel="noreferrer">Official rules ↗</a>
        )}
      </Card>

      {pending.length > 0 && (
        <Card title={`Proposed rule updates (${pending.length})`}>
          <div className="stack">
            {pending.map((p) => (
              <ProposalView key={p.id} p={p} who={p.proposed_by ? byId[p.proposed_by]?.display_name : undefined}>
                {isAdmin && (
                  <div className="row">
                    <Button size="sm" onClick={() => decide(p, true)}>Approve and replace rules</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(p, false)}>Reject</Button>
                  </div>
                )}
              </ProposalView>
            ))}
          </div>
        </Card>
      )}

      <Card title="🏠 House rules for this game" action={<Link to="/rules">All house rules →</Link>}>
        {houseRules.length === 0 ? (
          <Empty icon="📜">No approved house rules for this game.</Empty>
        ) : (
          <div className="list">
            {houseRules.map((r) => (
              <div key={r.id} className="list__item">
                <div className="list__main">
                  <div className="list__title">{r.title}</div>
                  <div className="list__meta prose">{r.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {past.length > 0 && (
        <Card title="Rules history">
          <div className="stack">
            {past.map((p) => (
              <ProposalView key={p.id} p={p} who={p.proposed_by ? byId[p.proposed_by]?.display_name : undefined} />
            ))}
          </div>
        </Card>
      )}

      {editing && <GameForm game={game} onClose={() => setEditing(false)} onSaved={load} />}
      {proposing && <ProposeRules gameId={game.id} current={game.rules_summary ?? ''} onClose={() => setProposing(false)} onSaved={load} />}
    </div>
  )
}

function ProposalView({ p, who, children }: { p: RuleProposal; who?: string; children?: React.ReactNode }) {
  const tone = p.status === 'approved' ? 'lime' : p.status === 'rejected' ? 'pink' : 'gold'
  return (
    <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none', padding: 'var(--space-4)' }}>
      <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
        <Badge tone={tone}>{p.status}</Badge>
        {p.origin === 'agent' && <Badge tone="purple">✨ AI draft</Badge>}
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {who ?? 'Someone'} · {formatDateTime(p.created_at)}
        </span>
      </div>
      <p className="prose">{p.proposed_text}</p>
      {p.sources.length > 0 && (
        <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
          <strong>Sources</strong>
          <ol style={{ margin: '4px 0 0', paddingLeft: '1.2rem' }}>
            {p.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
              </li>
            ))}
          </ol>
        </div>
      )}
      {children}
    </div>
  )
}

function ProposeRules({ gameId, current, onClose, onSaved }: { gameId: string; current: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [text, setText] = useState(current)
  const [sources, setSources] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed: RuleSource[] = sources
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const url = l.match(/https?:\/\/\S+/)?.[0] ?? ''
        return { url, title: l.replace(url, '').replace(/[-–|:]\s*$/, '').trim() }
      })
      .filter((s) => s.url)
    if (parsed.length === 0) return setError('Add at least one source link so others can check the rules.')
    const { error } = await supabase.from('rule_proposals').insert({
      game_id: gameId,
      proposed_text: text.trim(),
      sources: parsed,
      origin: 'manual',
      proposed_by: profile?.id,
    })
    if (error) setError(error.message)
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Modal title="Propose a rules update" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <TextArea label="Updated rules summary" value={text} onChange={(e) => setText(e.target.value)} rows={8} required />
        <TextArea
          label="Sources"
          value={sources}
          onChange={(e) => setSources(e.target.value)}
          rows={3}
          placeholder={'Official rulebook PDF – https://…\nPublisher FAQ – https://…'}
          hint="One per line: a title and a link. An admin reviews before the rules change."
        />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party">Submit proposal</Button>
      </form>
    </Modal>
  )
}
