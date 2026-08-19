import type { IdleEvent } from '@timetrack/contracts';

/**
 * Pure view-transforms for the idle-periods panel. No React, no I/O.
 *
 * Idle periods are *resolved on the macOS client* — the keep/discard prompt appears there and
 * syncs up. There is no write endpoint for them, so this panel reports the outcome rather than
 * offering an action, and says so in its own copy rather than rendering a dead button.
 */

/** Mirrors the contract's ResolvedAction — kept as a name so the maps below read clearly. */
export type IdleOutcome = IdleEvent['resolvedAction'];

export interface IdleRow {
  id: string;
  /** "10:48 – 11:05" in UTC, matching the rest of the day view. */
  range: string;
  durationSeconds: number;
  outcome: IdleOutcome;
  note: string;
  tone: 'neutral' | 'good' | 'warning';
}

const NOTE: Record<IdleOutcome, string> = {
  KEPT: 'Kept — counted as tracked time',
  DISCARDED: 'Discarded — removed from the day',
  UNRESOLVED: 'Not answered on the Mac app yet',
};

const TONE: Record<IdleOutcome, IdleRow['tone']> = {
  KEPT: 'good',
  DISCARDED: 'neutral',
  UNRESOLVED: 'warning',
};

function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

/**
 * Rows for one day's idle periods, longest first — the 45-minute gap is the one worth
 * explaining, and burying it under four 2-minute ones helps nobody.
 */
export function idleRows(events: IdleEvent[]): IdleRow[] {
  return events
    .map((e) => {
      const durationSeconds = Math.max(
        0,
        Math.round((Date.parse(e.endTime) - Date.parse(e.startTime)) / 1000),
      );
      const { resolvedAction } = e;
      return {
        id: e.id,
        range: `${hhmm(e.startTime)} – ${hhmm(e.endTime)}`,
        durationSeconds,
        outcome: resolvedAction,
        note: NOTE[resolvedAction],
        tone: TONE[resolvedAction],
      };
    })
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
}

export interface CategoryMix {
  productivePct: number;
  neutralPct: number;
  unproductivePct: number;
  /** Total samples the mix was computed from; 0 means "nothing to show". */
  sampled: number;
}

/**
 * The productive / neutral / unproductive split of a day's samples.
 *
 * The three percentages are forced to total exactly 100 by giving the rounding remainder to
 * the largest share, so the stacked bar never leaves a one-pixel sliver of track showing from
 * three independent Math.rounds.
 */
export function categoryMix(
  samples: ReadonlyArray<{ category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' }>,
): CategoryMix {
  const sampled = samples.length;
  if (sampled === 0) {
    return { productivePct: 0, neutralPct: 0, unproductivePct: 0, sampled: 0 };
  }
  const counts = {
    productivePct: samples.filter((s) => s.category === 'PRODUCTIVE').length,
    neutralPct: samples.filter((s) => s.category === 'NEUTRAL').length,
    unproductivePct: samples.filter((s) => s.category === 'UNPRODUCTIVE').length,
  };
  const keys = ['productivePct', 'neutralPct', 'unproductivePct'] as const;
  const pcts = keys.map((k) => Math.round((counts[k] * 100) / sampled));
  const drift = 100 - pcts.reduce((a, b) => a + b, 0);
  let biggest = 0;
  for (let i = 1; i < pcts.length; i++) if (pcts[i]! > pcts[biggest]!) biggest = i;
  pcts[biggest] = pcts[biggest]! + drift;

  return {
    productivePct: pcts[0]!,
    neutralPct: pcts[1]!,
    unproductivePct: pcts[2]!,
    sampled,
  };
}
