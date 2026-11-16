import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, PageHeader } from '../components/ui'

interface Settings {
  league_name: string
  placement_points: number[]
  participation_points: number
  require_declaration: boolean
  score_approvals_needed: number
  rules_agent_enabled: boolean
}

export function AdminSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [points, setPoints] = useState('')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    supabase.from('league_settings').select('*').single().then(({ data }) => {
      setS(data as Settings)
      setPoints((data as Settings).placement_points.join(', '))
    })
  }, [])
  if (!s) return <p className="muted">Loading…</p>

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed = points.split(',').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n))
    const { error } = await supabase
      .from('league_settings')
      .update({ ...s, placement_points: parsed })
      .eq('id', true)
    setMsg(error ? { tone: 'error', text: error.message } : { tone: 'success', text: 'Settings saved.' })
  }

  return (
    <>
      <PageHeader title="League settings" />
      <Card>
        <form className="stack" onSubmit={save}>
          <Field label="League name" value={s.league_name} onChange={(e) => setS({ ...s, league_name: e.target.value })} required />
          <Field label="Points for 1st, 2nd, 3rd…" value={points} onChange={(e) => setPoints(e.target.value)} hint="Comma separated. Places beyond the list get participation points." />
          <Field label="Participation points" type="number" min={0} value={s.participation_points} onChange={(e) => setS({ ...s, participation_points: Number(e.target.value) })} />
          <Field label="Player approvals needed per score" type="number" min={0} value={s.score_approvals_needed} onChange={(e) => setS({ ...s, score_approvals_needed: Number(e.target.value) })} />
          <label className="checkbox">
            <input type="checkbox" checked={s.require_declaration} onChange={(e) => setS({ ...s, require_declaration: e.target.checked })} />
            <span>Players must sign the fair play declaration before playing</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={s.rules_agent_enabled} onChange={(e) => setS({ ...s, rules_agent_enabled: e.target.checked })} />
            <span>
              Show the ✨ AI rules agent button
              <br />
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                Needs the rules-agent function deployed with your own free Gemini API key (see README).
              </span>
            </span>
          </label>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit">Save settings</Button>
        </form>
      </Card>
    </>
  )
}
