// Row types mirroring supabase/migrations. Extend here as features land.
export type AppRole = 'player' | 'admin'
export type ScoringType = 'high_score' | 'low_score' | 'win_loss' | 'placement' | 'rounds'
export type EventStatus = 'planned' | 'live' | 'finalised' | 'cancelled'

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  role: AppRole
  is_active: boolean
  bio: string | null
  created_at: string
}

export interface GamesNight {
  id: string
  name: string
  scheduled_at: string
  location: string | null
  status: EventStatus
}

export interface LeagueRow {
  player_id: string
  display_name: string
  points: number
  penalty_points: number
  total: number
  wins: number
  games_played: number
  nights_played: number
  win_rate: number
}
