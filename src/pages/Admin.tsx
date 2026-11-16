import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Alert, Badge, Card, PageHeader } from '../components/ui'
import { Stat } from './Players'

type Overview = Record<
  | 'players' | 'paused_players' | 'unsigned_players' | 'games' | 'nights_finalised' | 'nights_upcoming' | 'matches_played'
  | 'scores_waiting' | 'disputed_scores' | 'open_reports' | 'house_rule_votes' | 'rule_proposals' | 'audit_entries',
  number
>

const SECTIONS = [
  { to: '/admin/players', icon: '👥', title: 'Players & permissions', text: 'Promote admins, pause accounts.' },
  { to: '/games', icon: '🎲', title: 'Games library', text: 'Add, edit and archive games.' },
  { to: '/nights', icon: '🎉', title: 'Games nights', text: 'Plan, run and end nights.' },
  { to: '/admin/settings', icon: '⚙️', title: 'League settings', text: 'Points, approvals, declaration rule, AI rules agent.' },
  { to: '/admin/declaration', icon: '✍️', title: 'Fair play declaration', text: 'Edit the wording and ask everyone to re-sign.' },
  { to: '/notifications', icon: '📣', title: 'Announcements', text: 'Send a message to everyone.' },
  { to: '/admin/audit', icon: '🧾', title: 'Audit log', text: 'Every score, rule and admin change.' },
]

export function Admin() {
  const [o, setO] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('admin_overview').then(({ data, error }) => {
      if (error) setError(error.message)
      else setO(data as Overview)
    })
  }, [])

  const todos = o
    ? [
        o.disputed_scores && { to: '/nights', text: `${o.disputed_scores} game${o.disputed_scores > 1 ? 's have' : ' has'} disputed scores`, tone: 'pink' as const },
        o.open_reports && { to: '/disputes', text: `${o.open_reports} open report${o.open_reports > 1 ? 's' : ''} to decide`, tone: 'pink' as const },
        o.scores_waiting && { to: '/nights', text: `${o.scores_waiting} game${o.scores_waiting > 1 ? 's' : ''} waiting for score approval`, tone: 'gold' as const },
        o.house_rule_votes && { to: '/rules', text: `${o.house_rule_votes} house rule${o.house_rule_votes > 1 ? 's' : ''} being voted on`, tone: 'gold' as const },
        o.rule_proposals && { to: '/games', text: `${o.rule_proposals} official rules update${o.rule_proposals > 1 ? 's' : ''} to review`, tone: 'gold' as const },
        o.unsigned_players && { to: '/players', text: `${o.unsigned_players} player${o.unsigned_players > 1 ? 's haven’t' : ' hasn’t'} signed the current declaration`, tone: 'cyan' as const },
      ].filter(Boolean) as { to: string; text: string; tone: 'pink' | 'gold' | 'cyan' }[]
    : []

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <PageHeader title="Admin" subtitle="Run the league." />
      {error && <Alert tone="error">{error}</Alert>}
      {o && (
        <div className="stats">
          <Stat label="Players" value={o.players} />
          <Stat label="Games" value={o.games} />
          <Stat label="Nights played" value={o.nights_finalised} />
          <Stat label="Upcoming" value={o.nights_upcoming} />
          <Stat label="Games played" value={o.matches_played} />
          <Stat label="Audit entries" value={o.audit_entries} />
        </div>
      )}
      <Card title="📋 Needs attention" highlight>
        {!o ? (
          <p className="muted">Loading…</p>
        ) : todos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing waiting on you. 🎉</p>
        ) : (
          <div className="list">
            {todos.map((t) => (
              <Link key={t.text} to={t.to} className="list__item">
                <Badge tone={t.tone}>●</Badge>
                <span className="list__main">{t.text}</span>
                <span className="muted">›</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <div className="grid">
        {SECTIONS.map((s) => (
          <Link key={s.title} to={s.to} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Card title={<>{s.icon} {s.title}</>}>
              <p className="muted" style={{ margin: 0 }}>{s.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
