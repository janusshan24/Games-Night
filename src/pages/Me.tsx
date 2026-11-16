import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Alert, Avatar, Badge, Button, Card, Field, PageHeader } from '../components/ui'

type Theme = 'system' | 'dark' | 'light'

function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

export function initTheme() {
  try {
    applyTheme((localStorage.getItem('gn-theme') as Theme | null) ?? 'system')
  } catch {
    /* storage unavailable */
  }
}

export function Me() {
  const { profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('gn-theme') as Theme | null) ?? 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    setName(profile?.display_name ?? '')
    setBio(profile?.bio ?? '')
  }, [profile])

  if (!profile) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('profiles').update({ display_name: name.trim(), bio: bio.trim() || null }).eq('id', profile!.id)
    setMsg(error ? { tone: 'error', text: error.message } : { tone: 'success', text: 'Profile saved.' })
    if (!error) await refreshProfile()
  }

  function pickTheme(t: Theme) {
    setTheme(t)
    applyTheme(t)
    try {
      localStorage.setItem('gn-theme', t)
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <>
      <PageHeader title="My profile" />
      <div className="grid">
        <Card>
          <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
            <Avatar id={profile.id} name={profile.display_name} size={56} />
            <div>
              <h3 style={{ margin: 0 }}>{profile.display_name}</h3>
              <Badge tone={profile.role === 'admin' ? 'pink' : 'cyan'}>{profile.role}</Badge>
            </div>
          </div>
          <form className="stack" onSubmit={save}>
            <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
            <label className="field">
              <span className="field__label">Bio</span>
              <textarea className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} placeholder="Favourite game, trash talk, etc." />
            </label>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit">Save profile</Button>
          </form>
        </Card>
        <Card title="Appearance">
          <div className="row">
            {(['system', 'dark', 'light'] as Theme[]).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} size="sm" onClick={() => pickTheme(t)}>
                {t === 'system' ? 'Match device' : t === 'dark' ? '🌙 Night party' : '☀️ Day party'}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
