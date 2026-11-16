import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Game } from '../lib/types'
import { GamePicker } from '../components/GamePicker'
import { Card, PageHeader } from '../components/ui'

export function Picker() {
  const [games, setGames] = useState<Game[] | null>(null)
  const navigate = useNavigate()
  useEffect(() => {
    supabase.from('games').select('*').then(({ data }) => setGames((data as Game[] | null) ?? []))
  }, [])
  return (
    <>
      <PageHeader title="Random game picker" subtitle="Can't decide? Let fate choose." />
      <Card highlight>
        {games ? <GamePicker games={games} onPick={(g) => navigate(`/games/${g.id}`)} pickLabel="See rules" /> : <p className="muted">Loading…</p>}
      </Card>
    </>
  )
}
