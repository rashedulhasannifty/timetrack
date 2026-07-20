/** Pure retention/partition math — unit-tested without a DB (mirrors partition.util.ts). */

const DAY_MS = 86_400_000;

/** Names come from pg_inherits; still validated before any DROP as defense in depth. */
export const PARTITION_NAME_RE = /^(screenshots|activity_samples)_\d{4}_\d{2}$/;

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Half-open [from, to) UTC month bounds. The month suffix is the last two `_` tokens,
 *  so `activity_samples_2025_12` (underscored table) parses correctly. */
export function partitionBounds(partitionName: string): { from: Date; to: Date } {
  const parts = partitionName.split('_');
  const month = Number(parts[parts.length - 1]);
  const year = Number(parts[parts.length - 2]);
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

/** A partition is droppable iff its entire range is at or before cutoffMax. */
export function isDroppable(bounds: { to: Date }, cutoffMax: Date): boolean {
  return bounds.to.getTime() <= cutoffMax.getTime();
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
