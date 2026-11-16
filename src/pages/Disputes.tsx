import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProfiles } from '../hooks/useProfiles'
import type { GamesNight } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Alert, Avatar, Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, TextArea } from '../components/ui'

type IncidentStatus = 'open' | 'voting' | 'upheld' | 'dismissed'
interface Evidence {
  url: string
  note: string
}
interface Incident {
  id: string
  event_id: string | null
  reported_by: string
  accused_id: string | null
  title: string
  description: string
  evidence: Evidence[]
  status: IncidentStatus
  proposed_penalty: number | null
  resolution: string | null
  resolved_at: string | null
  created_at: string
}
interface Vote {
  incident_id: string
  voter_id: string
  uphold: boolean
  comment: string | null
}
interface Penalty {
  id: string
  player_id: string
  points: number
  reason: string
  revoked_at: string | null
  created_at: string
}

const STATUS: Record<IncidentStatus, { tone: 'gold' | 'cyan' | 'pink' | 'lime'; label: string }> = {
  open: { tone: 'gold', label: 'Open for votes' },
  voting: { tone: 'gold', label: 'Open for votes' },
  upheld: { tone: 'pink', label: 'Upheld' },
  dismissed: { tone: 'lime', label: 'Dismissed' },
}

export function Disputes() {
  const { profile, isAdmin } = useAuth()
  const { byId, profiles } = useProfiles()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [votes, setVotes] = useState<Vote[]>([])
  const [penalties, setPenalties] = useState<Penalty[]>([])
  const [nights, setNights] = useState<Record<string, GamesNight>>({})
  const [reporting, setReporting] = useState(false)
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [tab, setTab] = useState<'open' | 'closed' | 'penalties'>('open')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [i, v, p, n] = await Promise.all([
      supabase.from('incidents').select('*').order('created_at', { ascending: false }),
      supabase.from('incident_votes').select('*'),
      supabase.from('penalties').select('*').order('created_at', { ascending: false }),
      supabase.from('events').select('id,name,scheduled_at,location,status').order('scheduled_at', { ascending: false }).limit(30),
    ])
    setIncidents((i.data as Incident[] | null) ?? [])
    setVotes((v.data as Vote[] | null) ?? [])
    setPenalties((p.data as Penalty[] | null) ?? [])
    setNights(Object.fromEntries(((n.data as GamesNight[] | null) ?? []).map((x) => [x.id, x])))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function vote(inc: Incident, uphold: boolean) {
    setError(null)
    const mine = votes.find((v) => v.incident_id === inc.id && v.voter_id === profile!.id)
    const { error } = mine
      ? await supabase.from('incident_votes').update({ uphold, voted_at: new Date().toISOString() }).eq('incident_id', inc.id).eq('voter_id', profile!.id)
      : await supabase.from('incident_votes').insert({ incident_id: inc.id, voter_id: profile!.id, uphold })
    if (error) setError(error.message)
    await load()
  }

  async function revoke(p: Penalty) {
    const { error } = await supabase.from('penalties').update({ revoked_at: new Date().toISOString(), revoked_by: profile!.id }).eq('id', p.id)
    if (error) setError(error.message)
    await load()
  }

  const name = (id: string | null) => (id ? byId[id]?.display_name ?? 'Someone' : 'Nobody named')
  const open = incidents.filter((i) => i.status === 'open' || i.status === 'voting')
  const closed = incidents.filter((i) => i.status === 'upheld' || i.status === 'dismissed')
  const shown = tab === 'open' ? open : closed

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Report cheating or a rules problem. Everyone votes, an admin applies the group’s decision."
        action={<Button variant="party" onClick={() => setReporting(true)}>⚖️ Report something</Button>}
      />
      <div className="tabs">
        <Button size="sm" variant={tab === 'open' ? 'primary' : 'secondary'} onClick={() => setTab('open')}>🗳️ Open ({open.length})</Button>
        <Button size="sm" variant={tab === 'closed' ? 'primary' : 'secondary'} onClick={() => setTab('closed')}>📁 Resolved ({closed.length})</Button>
        <Button size="sm" variant={tab === 'penalties' ? 'primary' : 'secondary'} onClick={() => setTab('penalties')}>
          🟥 Penalties ({penalties.filter((p) => !p.revoked_at).length})
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      {tab === 'penalties' ? (
        <Card>
          {penalties.length === 0 ? (
            <Empty icon="😇">No penalties. What a fair bunch.</Empty>
          ) : (
            <div className="list">
              {penalties.map((p) => (
                <div key={p.id} className="list__item" style={{ opacity: p.revoked_at ? 0.55 : 1 }}>
                  <Avatar id={p.player_id} name={name(p.player_id)} />
                  <div className="list__main">
                    <div className="list__title">
                      {name(p.player_id)} · −{p.points} pts {p.revoked_at && <Badge>Revoked</Badge>}
                    </div>
                    <div className="list__meta">{p.reason} · {formatDateTime(p.created_at)}</div>
                  </div>
                  {isAdmin && !p.revoked_at && <Button size="sm" variant="ghost" onClick={() => revoke(p)}>Revoke</Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <Empty icon="⚖️">{tab === 'open' ? 'No open reports.' : 'Nothing resolved yet.'}</Empty>
        </Card>
      ) : (
        <div className="stack">
          {shown.map((inc) => {
            const iv = votes.filter((v) => v.incident_id === inc.id)
            const up = iv.filter((v) => v.uphold).length
            const mine = iv.find((v) => v.voter_id === profile?.id)
            const isOpen = inc.status === 'open' || inc.status === 'voting'
            const isAccused = inc.accused_id === profile?.id
            return (
              <Card key={inc.id} title={inc.title} action={<Badge tone={STATUS[inc.status].tone}>{STATUS[inc.status].label}</Badge>}>
                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                  About <strong>{name(inc.accused_id)}</strong> · reported by {name(inc.reported_by)} · {formatDateTime(inc.created_at)}
                  {inc.event_id && nights[inc.event_id] && ` · ${nights[inc.event_id].name}`}
                </p>
                <p className="prose">{inc.description}</p>
                {inc.evidence.length > 0 && (
                  <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                    <strong>Evidence</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '1.2rem' }}>
                      {inc.evidence.map((e, i) => (
                        <li key={i}>
                          <a href={e.url} target="_blank" rel="noreferrer">{e.note || e.url}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {inc.proposed_penalty ? <p style={{ fontSize: 'var(--text-sm)' }}>Suggested penalty: <strong>{inc.proposed_penalty} points</strong></p> : null}
                {!isOpen && inc.resolution && <Alert tone={inc.status === 'upheld' ? 'error' : 'success'}>Decision: {inc.resolution}</Alert>}
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-3)' }}>
                  <div className="row">
                    {isOpen && !isAccused ? (
                      <>
                        <Button size="sm" variant={mine?.uphold === true ? 'primary' : 'secondary'} onClick={() => vote(inc, true)}>✋ Uphold ({up})</Button>
                        <Button size="sm" variant={mine?.uphold === false ? 'primary' : 'secondary'} onClick={() => vote(inc, false)}>🙅 Dismiss ({iv.length - up})</Button>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                        {isOpen && isAccused ? 'You can’t vote on a report about you. ' : ''}Votes: uphold {up} · dismiss {iv.length - up}
                      </span>
                    )}
                  </div>
                  {isAdmin && isOpen && <Button size="sm" onClick={() => setResolving(inc)}>Decide</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {reporting && (
        <ReportForm
          players={profiles.filter((p) => p.is_active && p.id !== profile?.id)}
          nights={Object.values(nights)}
          onClose={() => setReporting(false)}
          onSaved={load}
        />
      )}
      {resolving && (
        <ResolveForm
          incident={resolving}
          votes={votes.filter((v) => v.incident_id === resolving.id)}
          onClose={() => setResolving(null)}
          onSaved={load}
        />
      )}
    </>
  )
}

function ReportForm({ players, nights, onClose, onSaved }: { players: { id: string; display_name: string }[]; nights: GamesNight[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [accused, setAccused] = useState('')
  const [eventId, setEventId] = useState(nights.find((n) => n.status === 'live')?.id ?? '')
  const [penalty, setPenalty] = useState('')
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const ev: Evidence[] = evidence
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const url = l.match(/https?:\/\/\S+/)?.[0] ?? ''
        return { url, note: l.replace(url, '').trim() }
      })
      .filter((x) => x.url)
    const { error } = await supabase.from('incidents').insert({
      title: title.trim(),
      description: description.trim(),
      accused_id: accused || null,
      event_id: eventId || null,
      proposed_penalty: Number(penalty) || null,
      evidence: ev,
      reported_by: profile!.id,
    })
    if (error) setError(error.message)
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Modal title="⚖️ Report something" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="What happened, in a few words" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Peeked at the Codenames key card" />
        <TextArea label="Details" value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} />
        <Select label="Who is it about?" value={accused} onChange={(e) => setAccused(e.target.value)}>
          <option value="">Not about a person (rules problem)</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </Select>
        <Select label="Games night" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">None</option>
          {nights.map((n) => <option key={n.id} value={n.id}>{n.name} · {formatDateTime(n.scheduled_at)}</option>)}
        </Select>
        <TextArea
          label="Evidence links (optional)"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={2}
          placeholder={'Photo of the board https://…'}
          hint="One per line. Paste a link to a photo or video, e.g. from Google Photos or iCloud."
        />
        <Field label="Suggested penalty (points)" type="number" min={0} value={penalty} onChange={(e) => setPenalty(e.target.value)} />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party">Submit report</Button>
      </form>
    </Modal>
  )
}

function ResolveForm({ incident, votes, onClose, onSaved }: { incident: Incident; votes: Vote[]; onClose: () => void; onSaved: () => void }) {
  const up = votes.filter((v) => v.uphold).length
  const [uphold, setUphold] = useState(up > votes.length - up)
  const [points, setPoints] = useState(String(incident.proposed_penalty ?? 0))
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('resolve_incident', {
      p_incident: incident.id,
      p_uphold: uphold,
      p_penalty: uphold ? Number(points) || 0 : 0,
      p_resolution: resolution.trim(),
    })
    if (error) setError(error.message)
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Modal title={`Decide: ${incident.title}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="muted" style={{ margin: 0 }}>
          The group voted {up} to uphold and {votes.length - up} to dismiss.
        </p>
        <div className="row">
          <Button type="button" size="sm" variant={uphold ? 'primary' : 'secondary'} onClick={() => setUphold(true)} disabled={!incident.accused_id}>Uphold</Button>
          <Button type="button" size="sm" variant={!uphold ? 'primary' : 'secondary'} onClick={() => setUphold(false)}>Dismiss</Button>
        </div>
        {uphold && <Field label="Penalty points to deduct from the league table" type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />}
        <TextArea label="Decision note (everyone sees this)" value={resolution} onChange={(e) => setResolution(e.target.value)} required rows={3} />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant={uphold ? 'danger' : 'party'}>{uphold ? 'Uphold report' : 'Dismiss report'}</Button>
      </form>
    </Modal>
  )
}
