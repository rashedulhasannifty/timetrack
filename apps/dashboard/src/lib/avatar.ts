/** Deterministic initials + chip colors for people avatars (no PII beyond the name). */
export const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#e7efee', fg: '#0f5a53' },
  { bg: '#e9e7f3', fg: '#4a4494' },
  { bg: '#e5efe4', fg: '#2f6b2c' },
  { bg: '#f5ead9', fg: '#8a5410' },
  { bg: '#f6e3de', fg: '#93392c' },
  { bg: '#e1eef2', fg: '#155e6e' },
  { bg: '#f2e4ec', fg: '#8b2f5c' },
  { bg: '#ecebe5', fg: '#5b5947' },
];

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColors(name: string): { bg: string; fg: string } {
  return AVATAR_PALETTE[hash(name) % AVATAR_PALETTE.length]!;
}
