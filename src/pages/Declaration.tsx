import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { DeclarationVersion } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Alert, Badge, Button, Card, Field, PageHeader } from '../components/ui'

export function Declaration() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [version, setVersion] = useState<DeclarationVersion | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)
  const [signature, setSignature] = useState('')
  const [agree, setAgree] = useState(false)
  const [acceptPenalties, setAcceptPenalties] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const { data: v } = await supabase.from('declaration_versions').select('*').eq('is_current', true).maybeSingle()
      setVersion(v as DeclarationVersion | null)
      if (v) {
        const { data: d } = await supabase
          .from('declarations')
          .select('signed_at')
          .eq('player_id', profile.id)
          .eq('version_id', v.id)
          .order('signed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setSignedAt(d?.signed_at ?? null)
      }
    })()
  }, [profile])

  async function sign(e: FormEvent) {
    e.preventDefault()
    if (!profile || !version) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('declarations').insert({
      player_id: profile.id,
      version_id: version.id,
      signature_name: signature.trim(),
      accepts_penalties: acceptPenalties,
      user_agent: navigator.userAgent.slice(0, 300),
    })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setSignedAt(new Date().toISOString())
      setTimeout(() => navigate('/'), 1200)
    }
  }

  if (!version) return <p className="muted">Loading…</p>

  return (
    <>
      <PageHeader title={version.title} subtitle={`Version ${version.version}`} />
      <div className="stack">
        <Card highlight>
          <h3>My promise</h3>
          <p className="prose">{version.body}</p>
          <h3>Penalties I accept</h3>
          <p className="prose" style={{ margin: 0 }}>{version.penalty_terms}</p>
        </Card>
        {signedAt ? (
          <Card>
            <Badge tone="lime">✓ Signed</Badge>
            <p style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
              You signed this declaration on {formatDateTime(signedAt)}. Your signature is stored permanently with a timestamp.
            </p>
          </Card>
        ) : (
          <Card title="Sign">
            <form className="stack" onSubmit={sign}>
              <label className="checkbox">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I promise to play fairly, as described above.</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={acceptPenalties} onChange={(e) => setAcceptPenalties(e.target.checked)} />
                <span>I accept the penalties the group agrees if a cheating report against me is upheld.</span>
              </label>
              <Field
                label="Type your full name as your signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                required
                minLength={2}
                style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}
              />
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" variant="party" disabled={!agree || !acceptPenalties || signature.trim().length < 2 || busy}>
                ✍️ Sign declaration
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
