/** Deterministic initials + chip colors for people avatars (no PII beyond the name). */
export const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#cfe4ff', fg: '#0b3d80' },
  { bg: '#ede0ff', fg: '#4b2673' },
  { bg: '#d3f2e3', fg: '#0f5132' },
  { bg: '#ffe6cc', fg: '#8a4b00' },
  { bg: '#ffd9e0', fg: '#8a1030' },
  { bg: '#d9f0f5', fg: '#0a4d5c' },
  { bg: '#fff3cc', fg: '#7a5900' },
  { bg: '#e3e6ea', fg: '#3a3f47' },
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
