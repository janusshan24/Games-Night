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

export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'retired'
export type MatchStatus = 'setup' | 'in_progress' | 'scoring' | 'completed' | 'void'
export type RsvpStatus = 'invited' | 'going' | 'maybe' | 'declined'

export interface Game {
  id: string
  name: string
  description: string | null
  category: string | null
  min_players: number
  max_players: number
  estimated_minutes: number | null
  scoring_type: ScoringType
  supports_teams: boolean
  rules_summary: string | null
  official_rules_url: string | null
  image_url: string | null
  tags: string[]
  archived_at: string | null
  created_by: string | null
}

export interface RuleSource {
  title: string
  url: string
}

export interface RuleProposal {
  id: string
  game_id: string
  proposed_text: string
  sources: RuleSource[]
  origin: 'manual' | 'agent'
  status: ProposalStatus
  proposed_by: string | null
  created_at: string
}

export interface HouseRule {
  id: string
  game_id: string | null
  title: string
  body: string
  status: ProposalStatus
  proposed_by: string | null
  created_at: string
}

export interface DeclarationVersion {
  id: string
  version: number
  title: string
  body: string
  penalty_terms: string
}

export interface EventParticipant {
  event_id: string
  player_id: string
  rsvp: RsvpStatus
  attended: boolean
  checked_in_at: string | null
}

export interface Match {
  id: string
  event_id: string
  game_id: string
  status: MatchStatus
  is_team_game: boolean
  scoring_type: ScoringType
  started_at: string | null
  ended_at: string | null
  void_reason: string | null
  created_at: string
}

export const SCORING_LABELS: Record<ScoringType, string> = {
  high_score: 'Highest score wins',
  low_score: 'Lowest score wins',
  win_loss: 'Win / lose',
  placement: 'Finishing places',
  rounds: 'Points per round',
}

export interface Team {
  id: string
  match_id: string
  name: string
  color: string | null
}

export interface ScoreEntry {
  id: string
  match_id: string
  player_id: string | null
  team_id: string | null
  round: number | null
  value: number | null
  placement: number | null
  is_winner: boolean | null
  status: 'pending' | 'approved' | 'disputed' | 'superseded'
  submitted_by: string
  submitted_at: string
}

export interface ScoreApproval {
  score_entry_id: string
  player_id: string
  choice: 'approve' | 'dispute'
  comment: string | null
}

export interface MatchResult {
  match_id: string
  player_id: string
  team_id: string | null
  placement: number
  league_points: number
  is_winner: boolean
}

export interface MatchFull extends Match {
  current_round: number
  current_turn_player: string | null
  turn_order: string[]
  timer_seconds: number | null
  timer_started_at: string | null
}
