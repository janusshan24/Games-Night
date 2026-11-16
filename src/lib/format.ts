const AVATAR_COLOURS = ['#ff3d9a', '#8b5cf6', '#22d3ee', '#84cc16', '#f59e0b', '#ff8a3d', '#ec4899', '#06b6d4']

/** Stable party colour per player, so a player keeps their colour everywhere. */
export function playerColour(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
