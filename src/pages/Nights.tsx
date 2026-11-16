import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { EventStatus, GamesNight } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, TextArea } from '../components/ui'

export const STATUS_BADGE: Record<EventStatus, { tone: 'lime' | 'cyan' | 'gold' | 'pink'; label: string }> = {
  live: { tone: 'lime', label: '● Live' },
  planned: { tone: 'cyan', label: 'Planned' },
  finalised: { tone: 'gold', label: 'Finalised' },
  cancelled: { tone: 'pink', label: 'Cancelled' },
}

export function Nights() {
  const { isAdmin } = useAuth()
  const [nights, setNights] = useState<GamesNight[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    supabase
      .from('events')
      .select('id,name,scheduled_at,location,status')
      .order('scheduled_at', { ascending: false })
      .then(({ data }) => setNights((data as GamesNight[] | null) ?? []))
  }, [])

  const upcoming = nights.filter((n) => n.status === 'planned' || n.status === 'live').reverse()
  const past = nights.filter((n) => n.status === 'finalised' || n.status === 'cancelled')

  return (
    <>
      <PageHeader
        title="Games nights"
        action={isAdmin && <Button variant="party" onClick={() => setCreating(true)}>+ Plan a night</Button>}
      />
      <div className="stack">
        <Card title="Coming up" highlight>
          {upcoming.length === 0 ? <Empty icon="🎉">Nothing planned yet.</Empty> : <NightList nights={upcoming} />}
        </Card>
        <Card title="Past nights" action={<Link to="/history">History →</Link>}>
          {past.length === 0 ? <Empty icon="🗂️">No past nights yet.</Empty> : <NightList nights={past.slice(0, 5)} />}
        </Card>
      </div>
      {creating && <NightForm onClose={() => setCreating(false)} />}
    </>
  )
}

export function NightList({ nights }: { nights: GamesNight[] }) {
  return (
    <div className="list">
      {nights.map((n) => (
        <Link key={n.id} to={`/nights/${n.id}`} className="list__item">
          <span style={{ fontSize: 28 }}>🎉</span>
          <div className="list__main">
            <div className="list__title">{n.name}</div>
            <div className="list__meta">
              {formatDateTime(n.scheduled_at)}
              {n.location && ` · ${n.location}`}
            </div>
          </div>
          <Badge tone={STATUS_BADGE[n.status].tone}>{STATUS_BADGE[n.status].label}</Badge>
        </Link>
      ))}
    </div>
  )
}

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export function NightForm({ night, onClose, onSaved }: { night?: GamesNight & { notes?: string | null }; onClose: () => void; onSaved?: () => void }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const nextFriday = new Date()
  nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7))
  nextFriday.setHours(19, 30, 0, 0)
  const [name, setName] = useState(night?.name ?? 'Games Night')
  const [when, setWhen] = useState(toLocalInput(night ? new Date(night.scheduled_at) : nextFriday))
  const [location, setLocation] = useState(night?.location ?? '')
  const [notes, setNotes] = useState(night?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const row = { name: name.trim(), scheduled_at: new Date(when).toISOString(), location: location.trim() || null, notes: notes.trim() || null }
    if (night) {
      const { error } = await supabase.from('events').update(row).eq('id', night.id)
      if (error) return setError(error.message)
      onSaved?.()
      onClose()
    } else {
      const { data, error } = await supabase
        .from('events')
        .insert({ ...row, host_id: profile!.id, created_by: profile!.id })
        .select('id')
        .single()
      if (error) return setError(error.message)
      navigate(`/nights/${data.id}`)
    }
  }

  return (
    <Modal title={night ? 'Edit night' : 'Plan a games night'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="Date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Whose place?" />
        <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Bring snacks!" />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party">{night ? 'Save' : 'Create night'}</Button>
      </form>
    </Modal>
  )
}
