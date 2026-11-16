/** Fisher–Yates shuffle using the browser's crypto randomness. */
export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const r = new Uint32Array(1)
    crypto.getRandomValues(r)
    const j = r[0] % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const TEAM_PRESETS = [
  { name: 'Pink Panthers', color: '#ff3d9a' },
  { name: 'Cyan Sharks', color: '#22d3ee' },
  { name: 'Lime Lizards', color: '#a3e635' },
  { name: 'Gold Eagles', color: '#ffd23f' },
  { name: 'Purple Owls', color: '#8b5cf6' },
  { name: 'Orange Foxes', color: '#ff8a3d' },
]
