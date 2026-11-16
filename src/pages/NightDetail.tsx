import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProfiles } from '../hooks/useProfiles'
import type { EventParticipant, Game, GamesNight, Match, RsvpStatus } from '../lib/types'
import { formatDateTime } from '../lib/format'
import { Alert, Avatar, Badge, Button, Card, Empty, Modal, Select } from '../components/ui'
import { NightForm, STATUS_BADGE } from './Nights'
import { MATCH_BADGE } from './match/MatchDetail'
import { GamePicker } from '../components/GamePicker'

type Night = GamesNight & { notes: string | null; host_id: string | null }
interface MatchRow extends Match {
  match_participants: { player_id: string }[]
}

const RSVP_LABEL: Record<RsvpStatus, string> = { going: '✅ Going', maybe: '🤔 Maybe', declined: '❌ Can’t make it', invited: '✉️ Invited' }

export function NightDetail() {
  const { id } = useParams()
  const { profile, isAdmin } = useAuth()
  const { byId, profiles } = useProfiles()
  const [night, setNight] = useState<Night | null>(null)
  const [people, setPeople] = useState<EventParticipant[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [games, setGames] = useState<Record<string, Game>>({})
  const [signed, setSigned] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [n, p, m, g, v] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).maybeSingle(),
      supabase.from('event_participants').select('*').eq('event_id', id),
      supabase.from('matches').select('*, match_participants(player_id)').eq('event_id', id).order('created_at'),
      supabase.from('games').select('*'),
      supabase.from('declaration_versions').select('id').eq('is_current', true).maybeSingle(),
    ])
    setNight(n.data as Night | null)
    setPeople((p.data as EventParticipant[] | null) ?? [])
    setMatches((m.data as MatchRow[] | null) ?? [])
    setGames(Object.fromEntries(((g.data as Game[] | null) ?? []).map((x) => [x.id, x])))
    if (v.data) {
      const { data: d } = await supabase.from('declarations').select('player_id').eq('version_id', v.data.id)
      setSigned(new Set((d ?? []).map((r) => r.player_id as string)))
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  if (!night || !profile) return <p className="muted">Loading…</p>
  const open = night.status === 'planned' || night.status === 'live'
  const me = people.find((p) => p.player_id === profile.id)

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    const { error } = await op
    if (error) setError(error.message)
    await load()
  }

  const rsvp = (r: RsvpStatus) =>
    run(
      me
        ? supabase.from('event_participants').update({ rsvp: r }).eq('event_id', night.id).eq('player_id', profile.id)
        : supabase.from('event_participants').insert({ event_id: night.id, player_id: profile.id, rsvp: r }),
    )
  const checkIn = (playerId: string, attended: boolean) =>
    run(
      supabase
        .from('event_participants')
        .update({ attended, checked_in_at: attended ? new Date().toISOString() : null, ...(attended ? { rsvp: 'going' } : {}) })
        .eq('event_id', night.id)
        .eq('player_id', playerId),
    )
  const addPlayer = (playerId: string) =>
    run(supabase.from('event_participants').insert({ event_id: night.id, player_id: playerId, rsvp: 'going' }))
  const setStatus = (status: string) => run(supabase.from('events').update({ status }).eq('id', night.id))

  const notInvited = profiles.filter((p) => p.is_active && !people.some((x) => x.player_id === p.id))
  const order: RsvpStatus[] = ['going', 'maybe', 'invited', 'declined']
  const sortedPeople = [...people].sort((a, b) => Number(b.attended) - Number(a.attended) || order.indexOf(a.rsvp) - order.indexOf(b.rsvp))

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div>
        <Link to="/nights" className="muted">← Games nights</Link>
        <div className="page-header" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <h1 style={{ margin: 0 }}>{night.name}</h1>
              <Badge tone={STATUS_BADGE[night.status].tone}>{STATUS_BADGE[night.status].label}</Badge>
            </div>
            <p>
              {formatDateTime(night.scheduled_at)}
              {night.location && ` · ${night.location}`}
              {night.host_id && byId[night.host_id] && ` · hosted by ${byId[night.host_id].display_name}`}
            </p>
          </div>
          {isAdmin && open && (
            <div className="row">
              {night.status === 'planned' && <Button variant="party" onClick={() => setStatus('live')}>🎉 Start the night</Button>}
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              {night.status === 'planned' && <Button variant="ghost" size="sm" onClick={() => setStatus('cancelled')}>Cancel night</Button>}
            </div>
          )}
        </div>
        {night.notes && <p className="muted prose">{night.notes}</p>}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {open && (
        <Card title="Are you coming?" highlight>
          <div className="row">
            {(['going', 'maybe', 'declined'] as RsvpStatus[]).map((r) => (
              <Button key={r} size="sm" variant={me?.rsvp === r ? 'primary' : 'secondary'} onClick={() => rsvp(r)}>
                {RSVP_LABEL[r]}
              </Button>
            ))}
            {night.status === 'live' && me && !me.attended && (
              <Button size="sm" variant="party" onClick={() => checkIn(profile.id, true)}>📍 I’m here</Button>
            )}
          </div>
          {!signed.has(profile.id) && (
            <Alert>
              ✍️ You need to <Link to="/declaration">sign the fair play declaration</Link> before you can be added to a game.
            </Alert>
          )}
        </Card>
      )}

      <div className="grid" style={{ alignItems: 'start' }}>
        <Card title={`👥 Players (${people.filter((p) => p.attended).length} here · ${people.filter((p) => p.rsvp === 'going').length} going)`}>
          {people.length === 0 ? (
            <Empty icon="👥">Nobody has replied yet.</Empty>
          ) : (
            <div className="list">
              {sortedPeople.map((p) => {
                const who = byId[p.player_id]
                if (!who) return null
                return (
                  <div key={p.player_id} className="list__item">
                    <Avatar id={who.id} name={who.display_name} />
                    <div className="list__main">
                      <div className="list__title">{who.display_name}</div>
                      <div className="list__meta">
                        {p.attended ? '📍 Checked in' : RSVP_LABEL[p.rsvp]}
                        {!signed.has(p.player_id) && ' · declaration not signed'}
                      </div>
                    </div>
                    {isAdmin && open && (
                      <Button size="sm" variant={p.attended ? 'ghost' : 'secondary'} onClick={() => checkIn(p.player_id, !p.attended)}>
                        {p.attended ? 'Undo' : 'Check in'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {isAdmin && open && notInvited.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Select label="Add a player" value="" onChange={(e) => e.target.value && addPlayer(e.target.value)}>
                <option value="">Choose…</option>
                {notInvited.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </Select>
            </div>
          )}
        </Card>

        <Card
          title={`🎲 Games tonight (${matches.filter((m) => m.status !== 'void').length})`}
          action={
            night.status === 'live' && (
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>🎰 Random</Button>
                {isAdmin && <Button size="sm" variant="party" onClick={() => setAdding('')}>+ Add game</Button>}
              </div>
            )
          }
        >
          {matches.length === 0 ? (
            <Empty icon="🎲">{night.status === 'live' ? 'No games started yet.' : 'Games are added once the night starts.'}</Empty>
          ) : (
            <div className="list">
              {matches.map((m) => (
                <Link key={m.id} to={`/matches/${m.id}`} className="list__item">
                  <div className="list__main">
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="list__title">{games[m.game_id]?.name ?? 'Game'}</span>
                      <Badge tone={MATCH_BADGE[m.status].tone}>{MATCH_BADGE[m.status].label}</Badge>
                      {m.is_team_game && <Badge tone="purple">Teams</Badge>}
                    </div>
                    <div className="list__meta">
                      {m.match_participants.map((x) => byId[x.player_id]?.display_name).filter(Boolean).join(', ')}
                      {m.void_reason && ` · void: ${m.void_reason}`}
                    </div>
                  </div>
                  <span className="muted">›</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {editing && <NightForm night={night} onClose={() => setEditing(false)} onSaved={load} />}
      {picking && (
        <Modal title="🎰 Random game picker" onClose={() => setPicking(false)}>
          <GamePicker
            games={Object.values(games)}
            defaultPlayers={people.filter((p) => p.attended).length || undefined}
            exclude={matches.filter((m) => m.status !== 'void').map((m) => m.game_id)}
            onPick={isAdmin ? (g) => { setPicking(false); setAdding(g.id) } : undefined}
            pickLabel="Play this tonight"
          />
        </Modal>
      )}
      {adding !== null && (
        <AddMatch
          eventId={night.id}
          initialGame={adding}
          games={Object.values(games).filter((g) => !g.archived_at)}
          candidates={people.filter((p) => p.attended || p.rsvp === 'going').map((p) => p.player_id)}
          signed={signed}
          names={Object.fromEntries(Object.values(byId).map((p) => [p.id, p.display_name]))}
          onClose={() => setAdding(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function AddMatch({
  eventId,
  initialGame,
  games,
  candidates,
  signed,
  names,
  onClose,
  onSaved,
}: {
  eventId: string
  initialGame: string
  games: Game[]
  candidates: string[]
  signed: Set<string>
  names: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [gameId, setGameId] = useState(initialGame)
  const [teams, setTeams] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set(candidates.filter((c) => signed.has(c))))
  const [error, setError] = useState<string | null>(null)
  const game = games.find((g) => g.id === gameId)

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!game) return
    if (chosen.size < game.min_players || chosen.size > game.max_players) {
      return setError(`${game.name} needs ${game.min_players}–${game.max_players} players.`)
    }
    const { data, error } = await supabase
      .from('matches')
      .insert({ event_id: eventId, game_id: game.id, scoring_type: game.scoring_type, is_team_game: teams && game.supports_teams, created_by: profile!.id, turn_order: [...chosen] })
      .select('id')
      .single()
    if (error) return setError(error.message)
    const { error: e2 } = await supabase
      .from('match_participants')
      .insert([...chosen].map((player_id, i) => ({ match_id: data.id, player_id, seat: i + 1 })))
    if (e2) return setError(e2.message)
    onSaved()
    navigate(`/matches/${data.id}`)
  }

  return (
    <Modal title="Add a game to tonight" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Select label="Game" value={gameId} onChange={(e) => setGameId(e.target.value)} required>
          <option value="">Choose a game…</option>
          {games.sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({g.min_players}–{g.max_players})</option>
          ))}
        </Select>
        {game?.supports_teams && (
          <label className="checkbox">
            <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} />
            <span>Play in teams</span>
          </label>
        )}
        <div className="field">
          <span className="field__label">Who's playing? ({chosen.size})</span>
          {candidates.length === 0 && <span className="muted">Check players in first.</span>}
          {candidates.map((id) => (
            <label key={id} className="checkbox">
              <input type="checkbox" checked={chosen.has(id)} disabled={!signed.has(id)} onChange={() => toggle(id)} />
              <span>
                {names[id]} {!signed.has(id) && <span className="muted">(must sign declaration)</span>}
              </span>
            </label>
          ))}
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party" disabled={!game}>Add game</Button>
      </form>
    </Modal>
  )
}
