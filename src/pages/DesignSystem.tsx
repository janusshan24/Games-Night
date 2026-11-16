import { Alert, Avatar, Badge, Button, Card, Field, PageHeader, Rank } from '../components/ui'

const SWATCHES = [
  ['Party pink', '--party-pink'],
  ['Purple', '--party-purple'],
  ['Cyan', '--party-cyan'],
  ['Lime', '--party-lime'],
  ['Gold', '--party-gold'],
  ['Orange', '--party-orange'],
  ['Surface', '--surface'],
  ['Surface 2', '--surface-2'],
]

/** Living reference for the shared components. Every new screen should be built from these. */
export function DesignSystem() {
  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <PageHeader title="Design system" subtitle="Party theme tokens and components shared by every screen." />
      <Card title="Colours">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
          {SWATCHES.map(([label, v]) => (
            <div key={v}>
              <div className="swatch" style={{ background: `var(${v})` }} />
              <div style={{ fontSize: 'var(--text-sm)', marginTop: 6 }}>{label}</div>
              <code className="muted" style={{ fontSize: 'var(--text-xs)' }}>{v}</code>
            </div>
          ))}
        </div>
        <div className="swatch" style={{ background: 'var(--gradient-party)', marginTop: 'var(--space-4)' }} />
      </Card>
      <Card title="Typography">
        <h1>Display heading</h1>
        <h2>Section heading</h2>
        <h3>Card heading</h3>
        <p>Body text in Inter. Headings in Fredoka for a playful party feel.</p>
        <p className="muted">Muted text for supporting detail.</p>
      </Card>
      <Card title="Buttons">
        <div className="row">
          <Button variant="party">Start the night</Button>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Report</Button>
          <Button size="sm">Small</Button>
        </div>
      </Card>
      <Card title="Badges, ranks and avatars">
        <div className="row">
          <Badge tone="pink">Admin</Badge>
          <Badge tone="cyan">Planned</Badge>
          <Badge tone="lime">● Live</Badge>
          <Badge tone="gold">Pending approval</Badge>
          <Badge tone="purple">Team game</Badge>
          <Badge>Archived</Badge>
        </div>
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <Rank n={1} /> <Rank n={2} /> <Rank n={3} /> <Rank n={4} />
          <Avatar id="a" name="Alex Morgan" /> <Avatar id="b" name="Sam" /> <Avatar id="c" name="Jo Lee" />
        </div>
      </Card>
      <Card title="Forms and alerts">
        <div className="stack">
          <Field label="Game name" placeholder="e.g. Codenames" hint="Hints sit under the field." />
          <Alert tone="success">Score approved by all players.</Alert>
          <Alert tone="error">This score is disputed.</Alert>
        </div>
      </Card>
    </div>
  )
}
