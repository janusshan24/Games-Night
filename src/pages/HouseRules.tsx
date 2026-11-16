import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProfiles } from '../hooks/useProfiles'
import type { Game, HouseRule, ProposalStatus } from '../lib/types'
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, TextArea } from '../components/ui'

interface Vote {
  house_rule_id: string
  voter_id: string
  in_favour: boolean
}

const TABS: { key: ProposalStatus; label: string }[] = [
  { key: 'proposed', label: '🗳️ Voting' },
  { key: 'approved', label: '✅ In force' },
  { key: 'rejected', label: '❌ Rejected' },
  { key: 'retired', label: '📦 Retired' },
]

export function HouseRules() {
  const { profile, isAdmin } = useAuth()
  const { byId, profiles } = useProfiles()
  const [rules, setRules] = useState<HouseRule[]>([])
  const [votes, setVotes] = useState<Vote[]>([])
  const [games, setGames] = useState<Record<string, Game>>({})
  const [tab, setTab] = useState<ProposalStatus>('proposed')
  const [proposing, setProposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, v, g] = await Promise.all([
      supabase.from('house_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('house_rule_votes').select('house_rule_id, voter_id, in_favour'),
      supabase.from('games').select('*'),
    ])
    setRules((r.data as HouseRule[] | null) ?? [])
    setVotes((v.data as Vote[] | null) ?? [])
    setGames(Object.fromEntries(((g.data as Game[] | null) ?? []).map((x) => [x.id, x])))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function vote(rule: HouseRule, inFavour: boolean) {
    setError(null)
    const { error } = await supabase
      .from('house_rule_votes')
      .upsert({ house_rule_id: rule.id, voter_id: profile!.id, in_favour: inFavour, voted_at: new Date().toISOString() })
    if (error) setError(error.message)
    await load()
  }

  async function decide(rule: HouseRule, status: ProposalStatus) {
    const { error } = await supabase
      .from('house_rules')
      .update({ status, decided_by: profile!.id, decided_at: new Date().toISOString() })
      .eq('id', rule.id)
    if (error) setError(error.message)
    await load()
  }

  const activePlayers = profiles.filter((p) => p.is_active).length
  const shown = rules.filter((r) => r.status === tab)

  return (
    <>
      <PageHeader
        title="House rules"
        subtitle="Your group's own rules. Propose one, everyone votes, an admin makes it official."
        action={<Button variant="party" onClick={() => setProposing(true)}>+ Propose a rule</Button>}
      />
      <div className="tabs">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
            {t.label} ({rules.filter((r) => r.status === t.key).length})
          </Button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {shown.length === 0 ? (
        <Card>
          <Empty icon="📜">Nothing here yet.</Empty>
        </Card>
      ) : (
        <div className="stack">
          {shown.map((r) => {
            const rv = votes.filter((v) => v.house_rule_id === r.id)
            const yes = rv.filter((v) => v.in_favour).length
            const no = rv.length - yes
            const mine = rv.find((v) => v.voter_id === profile?.id)
            const game = r.game_id ? games[r.game_id] : null
            return (
              <Card
                key={r.id}
                title={r.title}
                action={game ? <Link to={`/games/${game.id}`}><Badge tone="purple">{game.name}</Badge></Link> : <Badge tone="cyan">All games</Badge>}
              >
                <p className="prose">{r.body}</p>
                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                  Proposed by {r.proposed_by ? byId[r.proposed_by]?.display_name ?? 'someone' : 'someone'}
                </p>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row">
                    {r.status === 'proposed' ? (
                      <>
                        <Button size="sm" variant={mine?.in_favour === true ? 'primary' : 'secondary'} onClick={() => vote(r, true)}>👍 {yes}</Button>
                        <Button size="sm" variant={mine?.in_favour === false ? 'primary' : 'secondary'} onClick={() => vote(r, false)}>👎 {no}</Button>
                        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{rv.length} of {activePlayers} voted</span>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Final vote 👍 {yes} · 👎 {no}</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="row">
                      {r.status === 'proposed' && (
                        <>
                          <Button size="sm" onClick={() => decide(r, 'approved')}>Approve</Button>
                          <Button size="sm" variant="ghost" onClick={() => decide(r, 'rejected')}>Reject</Button>
                        </>
                      )}
                      {r.status === 'approved' && <Button size="sm" variant="ghost" onClick={() => decide(r, 'retired')}>Retire</Button>}
                      {r.status === 'retired' && <Button size="sm" variant="ghost" onClick={() => decide(r, 'approved')}>Bring back</Button>}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {proposing && <ProposeHouseRule games={Object.values(games).filter((g) => !g.archived_at)} onClose={() => setProposing(false)} onSaved={load} />}
    </>
  )
}

function ProposeHouseRule({ games, onClose, onSaved }: { games: Game[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [gameId, setGameId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('house_rules').insert({
      title: title.trim(),
      body: body.trim(),
      game_id: gameId || null,
      proposed_by: profile!.id,
    })
    if (error) setError(error.message)
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Modal title="Propose a house rule" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Rule" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. No phones at the table" />
        <TextArea label="Details" value={body} onChange={(e) => setBody(e.target.value)} required rows={4} />
        <Select label="Applies to" value={gameId} onChange={(e) => setGameId(e.target.value)}>
          <option value="">All games</option>
          {games.sort((a, b) => a.name.localeCompare(b.name)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party">Put it to a vote</Button>
      </form>
    </Modal>
  )
}
