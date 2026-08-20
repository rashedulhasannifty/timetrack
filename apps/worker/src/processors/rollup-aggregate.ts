import { ACTIVITY_SAMPLE_INTERVAL_SECONDS } from '@timetrack/contracts';

export interface RollupSample {
  userId: string;
  appName: string;
  category: string;
  activityPct: number;
}

export interface UserDailyRollup {
  userId: string;
  avgActivityPct: number;
  activeMinutes: number;
  byApp: Record<string, number>;
  byCategory: Record<string, number>;
}

const MINUTES_PER_SAMPLE = ACTIVITY_SAMPLE_INTERVAL_SECONDS / 60;

interface Acc {
  count: number;
  pctSum: number;
  byApp: Record<string, number>;
  byCategory: Record<string, number>;
}

/**
 * PRD §6.3 — pure rollup of one Dhaka day's samples into per-user summaries; the caller
 * picks the window (see `rollup-daily.util.ts`). Each sample
 * represents one fixed sampling interval, so minutes = count × interval / 60. No DB, no I/O.
 */
export function aggregateSamples(samples: RollupSample[]): UserDailyRollup[] {
  const byUser = new Map<string, Acc>();

  for (const s of samples) {
    let acc = byUser.get(s.userId);
    if (!acc) {
      acc = { count: 0, pctSum: 0, byApp: {}, byCategory: {} };
      byUser.set(s.userId, acc);
    }
    acc.count += 1;
    acc.pctSum += s.activityPct;
    acc.byApp[s.appName] = (acc.byApp[s.appName] ?? 0) + MINUTES_PER_SAMPLE;
    acc.byCategory[s.category] = (acc.byCategory[s.category] ?? 0) + MINUTES_PER_SAMPLE;
  }

  return [...byUser.entries()].map(([userId, acc]) => ({
    userId,
    avgActivityPct: Math.round(acc.pctSum / acc.count),
    activeMinutes: acc.count * MINUTES_PER_SAMPLE,
    byApp: acc.byApp,
    byCategory: acc.byCategory,
  }));
}
