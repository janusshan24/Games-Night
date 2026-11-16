import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeagueRow } from '../lib/types'
import { Card, Empty, PageHeader } from '../components/ui'
import { LeagueTable } from './Home'

export function League() {
  const [rows, setRows] = useState<LeagueRow[] | null>(null)
  useEffect(() => {
    supabase
      .from('league_table')
      .select('*')
      .order('total', { ascending: false })
      .then(({ data }) => setRows((data as LeagueRow[] | null) ?? []))
  }, [])

  return (
    <>
      <PageHeader title="League table" subtitle="Cumulative points across every finalised games night, minus penalties." />
      <Card>
        {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <Empty icon="🏆">No players yet.</Empty> : <LeagueTable rows={rows} />}
      </Card>
    </>
  )
}
