import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { SCORING_LABELS, type Game, type ScoringType } from '../lib/types'
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, TextArea } from '../components/ui'

export function Games() {
  const { isAdmin } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState('')
  const [category, setCategory] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Game | 'new' | null>(null)

  async function load() {
    const { data } = await supabase.from('games').select('*').order('name')
    setGames((data as Game[] | null) ?? [])
  }
  useEffect(() => {
    void load()
  }, [])

  const categories = useMemo(() => [...new Set(games.map((g) => g.category).filter(Boolean))] as string[], [games])
  const shown = games.filter((g) => {
    if (!showArchived && g.archived_at) return false
    if (query && !`${g.name} ${g.tags.join(' ')} ${g.description ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
    if (category && g.category !== category) return false
    const n = Number(players)
    if (n && (n < g.min_players || n > g.max_players)) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Games library"
        subtitle={`${games.filter((g) => !g.archived_at).length} games`}
        action={
          <div className="row">
            <Link to="/picker" className="btn btn--secondary">🎰 Pick for me</Link>
            <Button variant="party" onClick={() => setEditing('new')}>+ Add game</Button>
          </div>
        }
      />
      <Card>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 'var(--space-4)' }}>
          <Field label="Search" placeholder="Name or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Field label="Number of players" type="number" min={1} value={players} onChange={(e) => setPlayers(e.target.value)} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </div>
        {isAdmin && (
          <label className="checkbox" style={{ marginBottom: 'var(--space-3)' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="muted">Show archived games</span>
          </label>
        )}
        {shown.length === 0 ? (
          <Empty icon="🎲">{games.length ? 'No games match those filters.' : 'No games yet. Add the first one.'}</Empty>
        ) : (
          <div className="list">
            {shown.map((g) => (
              <Link key={g.id} to={`/games/${g.id}`} className="list__item">
                <span style={{ fontSize: 30 }}>{g.supports_teams ? '🤝' : '🎲'}</span>
                <div className="list__main">
                  <div className="list__title">
                    {g.name} {g.archived_at && <Badge>Archived</Badge>}
                  </div>
                  <div className="list__meta">
                    {g.min_players}–{g.max_players} players
                    {g.estimated_minutes ? ` · ~${g.estimated_minutes} min` : ''} · {SCORING_LABELS[g.scoring_type]}
                  </div>
                </div>
                {g.category && <Badge tone="purple">{g.category}</Badge>}
              </Link>
            ))}
          </div>
        )}
      </Card>
      {editing && <GameForm game={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  )
}

export function GameForm({ game, onClose, onSaved }: { game: Game | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [f, setF] = useState({
    name: game?.name ?? '',
    description: game?.description ?? '',
    category: game?.category ?? '',
    min_players: game?.min_players ?? 2,
    max_players: game?.max_players ?? 6,
    estimated_minutes: game?.estimated_minutes ?? 30,
    scoring_type: game?.scoring_type ?? ('placement' as ScoringType),
    supports_teams: game?.supports_teams ?? false,
    official_rules_url: game?.official_rules_url ?? '',
    rules_summary: game?.rules_summary ?? '',
    tags: game?.tags.join(', ') ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function save(e: FormEvent) {
    e.preventDefault()
    const row = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      category: f.category.trim() || null,
      min_players: Number(f.min_players),
      max_players: Number(f.max_players),
      estimated_minutes: Number(f.estimated_minutes) || null,
      scoring_type: f.scoring_type,
      supports_teams: f.supports_teams,
      official_rules_url: f.official_rules_url.trim() || null,
      rules_summary: f.rules_summary.trim() || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    }
    const { error } = game
      ? await supabase.from('games').update(row).eq('id', game.id)
      : await supabase.from('games').insert({ ...row, created_by: profile?.id })
    if (error) setError(error.message.includes('games_name_unique') ? 'A game with that name already exists.' : error.message)
    else {
      onSaved()
      onClose()
    }
  }

  return (
    <Modal title={game ? `Edit ${game.name}` : 'Add a game'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Name" value={f.name} onChange={set('name')} required />
        <TextArea label="Description" value={f.description} onChange={set('description')} rows={3} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Field label="Min players" type="number" min={1} value={f.min_players} onChange={set('min_players')} required />
          <Field label="Max players" type="number" min={1} value={f.max_players} onChange={set('max_players')} required />
          <Field label="Minutes" type="number" min={1} value={f.estimated_minutes} onChange={set('estimated_minutes')} />
        </div>
        <Select label="How is it scored?" value={f.scoring_type} onChange={set('scoring_type')}>
          {Object.entries(SCORING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="checkbox">
          <input type="checkbox" checked={f.supports_teams} onChange={(e) => setF({ ...f, supports_teams: e.target.checked })} />
          <span>Can be played in teams</span>
        </label>
        <Field label="Category" value={f.category} onChange={set('category')} placeholder="e.g. Card game, Party, Strategy" />
        <Field label="Tags" value={f.tags} onChange={set('tags')} hint="Comma separated, e.g. quick, bluffing" />
        <Field label="Official rules link" type="url" value={f.official_rules_url} onChange={set('official_rules_url')} placeholder="https://" />
        <TextArea label="Rules summary" value={f.rules_summary} onChange={set('rules_summary')} rows={5} />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="party">{game ? 'Save changes' : 'Add game'}</Button>
      </form>
    </Modal>
  )
}
