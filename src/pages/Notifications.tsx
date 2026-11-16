import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useNotifications } from '../hooks/useNotifications'
import { formatDateTime } from '../lib/format'
import { Alert, Button, Card, Empty, Field, PageHeader, TextArea } from '../components/ui'

export function Notifications() {
  const { isAdmin } = useAuth()
  const { items, unread, markRead, markAllRead, reload } = useNotifications(100)
  const navigate = useNavigate()
  const [announcing, setAnnouncing] = useState(false)

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'All caught up'}
        action={
          <div className="row">
            {isAdmin && !announcing && <Button variant="party" size="sm" onClick={() => setAnnouncing(true)}>📣 Announce</Button>}
            {unread > 0 && <Button variant="secondary" size="sm" onClick={markAllRead}>Mark all as read</Button>}
          </div>
        }
      />
      {isAdmin && announcing && <Announce onSent={() => { reload(); setAnnouncing(false) }} />}
      <Card>
        {items.length === 0 ? (
          <Empty icon="🔔">Nothing yet. You'll hear about new nights, scores to check, results and votes here.</Empty>
        ) : (
          <div className="list">
            {items.map((n) => (
              <button
                key={n.id}
                className={n.read ? 'list__item notif' : 'list__item notif notif--unread'}
                onClick={() => {
                  void markRead(n.id)
                  if (n.link) navigate(n.link)
                }}
              >
                <div className="list__main">
                  <div className="list__title">{n.title}</div>
                  {n.body && <div className="list__meta">{n.body}</div>}
                  <div className="list__meta" style={{ fontSize: 'var(--text-xs)' }}>{formatDateTime(n.created_at)}</div>
                </div>
                {!n.read && <span className="notif__dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Announce({ onSent }: { onSent: () => void }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('notifications').insert({ kind: 'announcement', title: `📣 ${title.trim()}`, body: body.trim() || null, created_by: profile!.id })
    setMsg(error ? { tone: 'error', text: error.message } : { tone: 'success', text: 'Sent to everyone.' })
    if (!error) {
      setTitle('')
      setBody('')
      onSent()
    }
  }

  return (
    <Card title="📣 Send an announcement">
      <form className="stack" onSubmit={send}>
        <Field label="Headline" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Pizza is on me this Friday" />
        <TextArea label="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" variant="party">Send to everyone</Button>
      </form>
    </Card>
  )
}
