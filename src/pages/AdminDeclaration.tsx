import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { DeclarationVersion } from '../lib/types'
import { Alert, Button, Card, Field, PageHeader, TextArea } from '../components/ui'

export function AdminDeclaration() {
  const [current, setCurrent] = useState<DeclarationVersion | null>(null)
  const [signed, setSigned] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [terms, setTerms] = useState('')
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function load() {
    const { data } = await supabase.from('declaration_versions').select('*').eq('is_current', true).maybeSingle()
    const v = data as DeclarationVersion | null
    setCurrent(v)
    if (v) {
      setTitle(v.title)
      setBody(v.body)
      setTerms(v.penalty_terms)
      const { count } = await supabase.from('declarations').select('id', { count: 'exact', head: true }).eq('version_id', v.id)
      setSigned(count ?? 0)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function publish(e: FormEvent) {
    e.preventDefault()
    if (!window.confirm('Publish a new version? Every player will need to sign it again before playing.')) return
    const { data, error } = await supabase.rpc('publish_declaration', { p_title: title.trim(), p_body: body.trim(), p_penalty_terms: terms.trim() })
    setMsg(error ? { tone: 'error', text: error.message } : { tone: 'success', text: `Version ${data} published. Everyone has been asked to re-sign.` })
    if (!error) await load()
  }

  return (
    <>
      <PageHeader title="Fair play declaration" subtitle={current ? `Version ${current.version} · signed by ${signed} player${signed === 1 ? '' : 's'}` : undefined} />
      <Card>
        <form className="stack" onSubmit={publish}>
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextArea label="What players promise" value={body} onChange={(e) => setBody(e.target.value)} rows={6} required />
          <TextArea label="Penalties they accept" value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} required />
          <Alert>Old versions and every signature are kept. Publishing creates a new version and asks everyone to sign it.</Alert>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit" variant="party">Publish new version</Button>
        </form>
      </Card>
    </>
  )
}
