import { clockOf, dayOf } from '@timetrack/contracts';

/** Presentation helpers. Pure functions — unit-tested in format.spec.ts. */

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The Dhaka calendar day an instant falls on (spec §3.2). */
export function formatDate(iso: string): string {
  return dayOf(new Date(iso));
}

/** Dhaka wall-clock range. A null end means the entry is still running. */
export function formatTimeRange(startIso: string, endIso: string | null): string {
  const startLabel = clockOf(new Date(startIso));
  if (!endIso) return `${startLabel}–…`;
  return `${startLabel}–${clockOf(new Date(endIso))}`;
}
