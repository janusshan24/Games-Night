import { Link } from 'react-router-dom'
import { Badge, Card, PageHeader } from '../components/ui'

const SECTIONS = [
  { to: '/admin/players', icon: '👥', title: 'Players & permissions', text: 'Promote admins, pause accounts.', ready: true },
  { to: '/games', icon: '🎲', title: 'Games library', text: 'Add, edit and archive games.', ready: true },
  { to: '/admin/settings', icon: '⚙️', title: 'League settings', text: 'Points per placement, approvals, declaration, AI rules agent.', ready: true },
  { to: '/admin', icon: '🧾', title: 'Audit log', text: 'Every score, rule and admin change.', ready: false },
]

export function Admin() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Run the league." />
      <div className="grid">
        {SECTIONS.map((s) => (
          <Link key={s.title} to={s.to} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Card title={<>{s.icon} {s.title}</>} action={s.ready ? null : <Badge>Soon</Badge>}>
              <p className="muted" style={{ margin: 0 }}>{s.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}
