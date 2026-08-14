export const AVATAR_COLORS = [
  '#2d5a3d', // green
  '#1e5a7a', // blue
  '#6b3fa0', // purple
  '#a03f5f', // rose
  '#8a5a20', // brown/orange
  '#2b6d66', // teal
  '#6b7a1e', // olive
]

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

export function avatarColorByPosition(position: string | null | undefined): string {
  const key = String(position || '—')
    .trim()
    .toLowerCase()
  const idx = hashString(key) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx] || AVATAR_COLORS[0]
}

