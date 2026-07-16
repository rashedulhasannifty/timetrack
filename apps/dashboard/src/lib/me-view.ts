import type { ActivitySample } from '@timetrack/contracts';
import type { ActivityPoint } from '../components/charts/ActivityChart';

/** Map raw activity samples to the ActivityChart's point shape (UTC HH:MM label). */
export function toActivityPoints(samples: ActivitySample[]): ActivityPoint[] {
  return samples.map((s) => ({
    label: s.timestamp.slice(11, 16),
    activityPct: s.activityPct,
  }));
}
