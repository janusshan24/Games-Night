import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

/** All players keyed by id, for showing names next to records. */
export function useProfiles() {
  const [map, setMap] = useState<Record<string, Profile>>({})
  const [list, setList] = useState<Profile[]>([])
  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('display_name')
      .then(({ data }) => {
        const rows = (data as Profile[] | null) ?? []
        setList(rows)
        setMap(Object.fromEntries(rows.map((p) => [p.id, p])))
      })
  }, [])
  return { profiles: list, byId: map }
}
