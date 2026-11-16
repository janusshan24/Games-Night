import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Alert, Button, Field } from '../components/ui'

type Mode = 'signin' | 'signup' | 'forgot'

export function Login() {
  const { session } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (session) return <Navigate to={from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setNotice('If that email has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="card card--highlight auth-card">
        <div style={{ textAlign: 'center' }}>
          <div className="shell__brand-mark" style={{ margin: '0 auto var(--space-3)', width: 56, height: 56, fontSize: 30 }}>
            🎲
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>
            Games <span className="gradient-text">Night</span>
          </h1>
          <p className="muted">
            {mode === 'signin' && 'Welcome back. Ready to play?'}
            {mode === 'signup' && 'Join the league.'}
            {mode === 'forgot' && 'Reset your password.'}
          </p>
        </div>
        <div className="confetti-dots" />
        <form className="stack" onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="nickname" />
          )}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {mode !== 'forgot' && (
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            />
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          <Button type="submit" variant="party" block disabled={busy}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
          {mode === 'signin' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode('signup')}>New here? Sign up</Button>
              <Button variant="ghost" size="sm" onClick={() => setMode('forgot')}>Forgot password</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setMode('signin')}>← Back to sign in</Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ResetPassword() {
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else setDone(true)
  }

  return (
    <div className="center-screen">
      <form className="card auth-card stack" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <Field label="New password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        {error && <Alert tone="error">{error}</Alert>}
        {done ? (
          <Alert tone="success">
            Password updated. <a href="/">Go to the app</a>
          </Alert>
        ) : (
          <Button type="submit" block>Save password</Button>
        )}
      </form>
    </div>
  )
}
