import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Game, MatchFull, MatchResult, ScoreApproval, ScoreEntry, Team } from '../lib/types'

export interface MatchData {
  match: MatchFull
  game: Game | null
  players: { player_id: string; team_id: string | null; seat: number | null }[]
  teams: Team[]
  entries: ScoreEntry[] // current submission only (not superseded)
  approvals: ScoreApproval[]
  results: MatchResult[]
}

/** Loads a match and keeps it live: every phone at the table sees changes as they happen. */
export function useMatch(id: string | undefined) {
  const [data, setData] = useState<MatchData | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const { data: match } = await supabase.from('matches').select('*').eq('id', id).maybeSingle()
    if (!match) return
    const [g, p, t, e, r] = await Promise.all([
      supabase.from('games').select('*').eq('id', match.game_id).maybeSingle(),
      supabase.from('match_participants').select('player_id, team_id, seat').eq('match_id', id).order('seat'),
      supabase.from('teams').select('*').eq('match_id', id).order('name'),
      supabase.from('score_entries').select('*').eq('match_id', id).neq('status', 'superseded').order('round'),
      supabase.from('match_results').select('*').eq('match_id', id).order('placement'),
    ])
    const entries = (e.data as ScoreEntry[] | null) ?? []
    const a = entries.length
      ? await supabase.from('score_approvals').select('*').in('score_entry_id', entries.map((x) => x.id))
      : { data: [] }
    setData({
      match: match as MatchFull,
      game: g.data as Game | null,
      players: p.data ?? [],
      teams: (t.data as Team[] | null) ?? [],
      entries,
      approvals: (a.data as ScoreApproval[] | null) ?? [],
      results: (r.data as MatchResult[] | null) ?? [],
    })
  }, [id])

  useEffect(() => {
    void load()
    if (!id) return
    const channel = supabase
      .channel(`match-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_entries', filter: `match_id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_approvals' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [id, load])

  return { data, reload: load }
}
