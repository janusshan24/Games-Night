import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { AppRole, Profile } from '../lib/types'
import { Alert, Avatar, Badge, Button, Card, PageHeader } from '../components/ui'

export function AdminPlayers() {
  const { profile: me } = useAuth()
  const [players, setPlayers] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('profiles').select('*').order('display_name')
    if (error) setError(error.message)
    setPlayers((data as Profile[] | null) ?? [])
  }
  useEffect(() => {
    void load()
  }, [])

  async function update(id: string, patch: Partial<Pick<Profile, 'role' | 'is_active'>>) {
    setError(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setError(error.message)
    await load()
  }

  const admins = players.filter((p) => p.role === 'admin' && p.is_active).length

  return (
    <>
      <PageHeader title="Players & permissions" subtitle="Promote admins and pause accounts. Nobody is ever deleted, so their history stays intact." />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const isSelf = p.id === me?.id
                const lastAdmin = p.role === 'admin' && admins <= 1
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                        <Avatar id={p.id} name={p.display_name} size={28} />
                        {p.display_name}
                        {isSelf && <span className="muted">(you)</span>}
                      </span>
                    </td>
                    <td><Badge tone={p.role === 'admin' ? 'pink' : 'cyan'}>{p.role}</Badge></td>
                    <td>{p.is_active ? <Badge tone="lime">Active</Badge> : <Badge>Paused</Badge>}</td>
                    <td className="num">
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={lastAdmin}
                          title={lastAdmin ? 'The league needs at least one admin' : undefined}
                          onClick={() => update(p.id, { role: (p.role === 'admin' ? 'player' : 'admin') as AppRole })}
                        >
                          {p.role === 'admin' ? 'Make player' : 'Make admin'}
                        </Button>
                        <Button
                          size="sm"
                          variant={p.is_active ? 'ghost' : 'secondary'}
                          disabled={isSelf}
                          onClick={() => update(p.id, { is_active: !p.is_active })}
                        >
                          {p.is_active ? 'Pause' : 'Reactivate'}
                        </Button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
