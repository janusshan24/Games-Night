import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProfiles } from '../hooks/useProfiles'
import { formatDateTime } from '../lib/format'
import { Badge, Button, Card, Empty, PageHeader, Select } from '../components/ui'

interface Entry {
  id: number
  actor_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  table_name: string
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

const AREAS: Record<string, string> = {
  score_entries: '📝 Scores',
  score_approvals: '✅ Score approvals',
  match_results: '🏆 Results',
  matches: '🎲 Games played',
  teams: '🤝 Teams',
  match_participants: '👥 Game players',
  events: '🎉 Games nights',
  event_participants: '🙋 Attendance',
  games: '📚 Games library',
  rule_proposals: '📖 Official rules',
  house_rules: '📜 House rules',
  incidents: '⚖️ Reports',
  incident_votes: '🗳️ Report votes',
  penalties: '🟥 Penalties',
  profiles: '👤 Players & roles',
  league_settings: '⚙️ League settings',
  declaration_versions: '✍️ Declaration',
}
const IGNORE = new Set(['updated_at', 'created_at'])
const PAGE = 50

function describe(e: Entry): string {
  const d = (e.new_data ?? e.old_data ?? {}) as Record<string, unknown>
  const label = (d.name ?? d.title ?? d.display_name ?? d.league_name ?? '') as string
  const verb = e.action === 'INSERT' ? 'Created' : e.action === 'UPDATE' ? 'Changed' : 'Removed'
  return `${verb} ${AREAS[e.table_name]?.replace(/^\S+\s/, '').toLowerCase() ?? e.table_name}${label ? ` “${label}”` : ''}`
}

function changes(e: Entry): [string, unknown, unknown][] {
  if (e.action !== 'UPDATE' || !e.old_data || !e.new_data) return []
  return Object.keys(e.new_data)
    .filter((k) => !IGNORE.has(k) && JSON.stringify(e.old_data![k]) !== JSON.stringify(e.new_data![k]))
    .map((k) => [k, e.old_data![k], e.new_data![k]])
}

const show = (v: unknown) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function AuditLog() {
  const { byId } = useProfiles()
  const [entries, setEntries] = useState<Entry[]>([])
  const [area, setArea] = useState('')
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(async () => {
    let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE)
    if (area) q = q.eq('table_name', area)
    const { data } = await q
    const rows = (data as Entry[] | null) ?? []
    setMore(rows.length > PAGE)
    setEntries(rows.slice(0, PAGE))
  }, [area, page])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader title="Audit log" subtitle="A permanent record of every change to scores, rules, players and settings." />
      <Card>
        <div style={{ maxWidth: 320, marginBottom: 'var(--space-4)' }}>
          <Select label="Show" value={area} onChange={(e) => { setArea(e.target.value); setPage(0) }}>
            <option value="">Everything</option>
            {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {entries.length === 0 ? (
          <Empty icon="🧾">No entries.</Empty>
        ) : (
          <div className="list">
            {entries.map((e) => {
              const diff = changes(e)
              return (
                <div key={e.id} className="list__item" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <div className="list__main">
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <Badge tone={e.action === 'INSERT' ? 'lime' : e.action === 'UPDATE' ? 'gold' : 'pink'}>{e.action.toLowerCase()}</Badge>
                      <span className="list__title">{describe(e)}</span>
                    </div>
                    <div className="list__meta">
                      {e.actor_id ? byId[e.actor_id]?.display_name ?? 'Unknown player' : 'System'} · {formatDateTime(e.created_at)}
                      {diff.length > 0 && ` · ${diff.map(([k]) => k.replace(/_/g, ' ')).join(', ')}`}
                    </div>
                    {open === e.id && (
                      <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
                        <table className="table" style={{ fontSize: 'var(--text-xs)' }}>
                          <thead>
                            <tr><th>Field</th><th>Before</th><th>After</th></tr>
                          </thead>
                          <tbody>
                            {(diff.length ? diff : Object.entries(e.new_data ?? e.old_data ?? {}).filter(([k]) => !IGNORE.has(k)).map(([k, v]) => [k, e.action === 'INSERT' ? undefined : v, e.action === 'INSERT' ? v : undefined] as [string, unknown, unknown])).map(([k, a, b]) => (
                              <tr key={k}>
                                <td>{k}</td>
                                <td style={{ wordBreak: 'break-word' }}>{show(a)}</td>
                                <td style={{ wordBreak: 'break-word' }}>{show(b)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-3)' }}>
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</Button>
          <Button size="sm" variant="secondary" disabled={!more} onClick={() => setPage(page + 1)}>Older →</Button>
        </div>
      </Card>
    </>
  )
}
