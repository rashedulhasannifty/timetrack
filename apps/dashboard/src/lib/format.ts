/** Presentation helpers. Pure functions — unit-tested in format.spec.ts. */

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function formatTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const startLabel = start.toISOString().slice(11, 16);
  if (!endIso) return `${startLabel}–…`;
  const endLabel = new Date(endIso).toISOString().slice(11, 16);
  return `${startLabel}–${endLabel}`;
}
