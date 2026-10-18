import { Injectable } from '@nestjs/common';
import { PartitionRangeRepository, type PartitionedTable } from './partition-range.repository.js';

/** How long a catalog read is reused. New partitions are provisioned months ahead and old ones
 *  are dropped nightly, so a few minutes of staleness is harmless; a per-request catalog query
 *  on the hottest ingest path is not. */
export const PARTITION_RANGE_TTL_MS = 5 * 60_000;

/** A client clock may run a little fast; anything beyond this is a broken clock, not skew. */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60_000;

export type PartitionBound =
  { kind: 'default' } | { kind: 'range'; from: Date | null; to: Date | null };

const RANGE_RE = /^FOR VALUES FROM \((.+)\) TO \((.+)\)$/;

/** `'2026-07-01 00:00:00'` → Date (the column is TIMESTAMP(3) holding UTC); MINVALUE/MAXVALUE → null. */
function parseLiteral(lit: string): Date | null | undefined {
  if (lit === 'MINVALUE' || lit === 'MAXVALUE') return null;
  const value = /^'([^']+)'$/.exec(lit)?.[1];
  if (value === undefined) return undefined;
  const d = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse one `pg_get_expr(relpartbound)` string. Returns null for anything unrecognised: an
 * unparsed partition contributes nothing, so a sample is never accepted on a guessed range.
 */
export function parsePartitionBound(expr: string): PartitionBound | null {
  if (expr.trim() === 'DEFAULT') return { kind: 'default' };
  const [, fromLit, toLit] = RANGE_RE.exec(expr.trim()) ?? [];
  if (fromLit === undefined || toLit === undefined) return null;
  const from = parseLiteral(fromLit);
  const to = parseLiteral(toLit);
  if (from === undefined || to === undefined) return null;
  return { kind: 'range', from, to };
}

interface CacheEntry {
  expiresAt: number;
  bounds: Promise<PartitionBound[]>;
}

/**
 * Answers "would Postgres accept a row at this `timestamp`?" for a partitioned table, from the
 * partitions that actually exist (cached for PARTITION_RANGE_TTL_MS). Ingest uses it to drop or
 * reject a timestamp that has nowhere to land, instead of letting the INSERT fail with
 * "no partition of relation found" — which 500s the whole request and wedges a client's queue.
 */
@Injectable()
export class PartitionRangeService {
  private readonly cache = new Map<PartitionedTable, CacheEntry>();

  constructor(private readonly repo: PartitionRangeRepository) {}

  /**
   * A predicate for `table`, evaluated against `now`: true iff the timestamp falls inside an
   * existing partition (half-open [from, to), like Postgres) and is no more than
   * MAX_FUTURE_SKEW_MS ahead of `now`.
   */
  async acceptor(table: PartitionedTable, now: Date = new Date()): Promise<(ts: Date) => boolean> {
    const bounds = await this.bounds(table, now.getTime());
    const hasDefault = bounds.some((b) => b.kind === 'default');
    const ranges = bounds.filter((b) => b.kind === 'range');
    const latest = now.getTime() + MAX_FUTURE_SKEW_MS;
    return (ts: Date) => {
      const t = ts.getTime();
      if (Number.isNaN(t) || t > latest) return false;
      if (hasDefault) return true;
      return ranges.some(
        (r) => (r.from === null || t >= r.from.getTime()) && (r.to === null || t < r.to.getTime()),
      );
    };
  }

  /** Drop the cached ranges — e.g. after an insert failed, in case a partition just vanished. */
  invalidate(table: PartitionedTable): void {
    this.cache.delete(table);
  }

  private bounds(table: PartitionedTable, nowMs: number): Promise<PartitionBound[]> {
    const hit = this.cache.get(table);
    if (hit && hit.expiresAt > nowMs) return hit.bounds;

    const bounds = this.repo
      .listPartitionBounds(table)
      .then((exprs) => exprs.map(parsePartitionBound).filter((b) => b !== null));
    // Cache the in-flight promise so concurrent requests share one catalog read; a failed read
    // is evicted so the next request retries instead of reusing the rejection.
    const entry: CacheEntry = { expiresAt: nowMs + PARTITION_RANGE_TTL_MS, bounds };
    this.cache.set(table, entry);
    bounds.catch(() => {
      if (this.cache.get(table) === entry) this.cache.delete(table);
    });
    return bounds;
  }
}
