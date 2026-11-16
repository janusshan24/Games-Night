import { Card, Empty, PageHeader } from '../components/ui'

export function Coming({ title, icon, phase, text }: { title: string; icon: string; phase?: number; text: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <Empty icon={icon}>
          <p>{text}</p>
          {phase && <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Arriving in phase {phase} of the build.</p>}
        </Empty>
      </Card>
    </>
  )
}
