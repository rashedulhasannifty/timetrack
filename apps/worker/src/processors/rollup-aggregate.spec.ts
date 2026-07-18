import { describe, expect, it } from 'vitest';
import { aggregateSamples, type RollupSample } from './rollup-aggregate.js';

function s(userId: string, appName: string, category: string, activityPct: number): RollupSample {
  return { userId, appName, category, activityPct };
}

describe('aggregateSamples', () => {
  it('rolls per user: rounded avg %, minutes = count (interval 60s), byApp and byCategory', () => {
    const out = aggregateSamples([
      s('u1', 'Xcode', 'PRODUCTIVE', 80),
      s('u1', 'Xcode', 'PRODUCTIVE', 40), // u1 Xcode avg contributes; 2 samples = 2 min
      s('u1', 'Slack', 'NEUTRAL', 60), // 1 sample = 1 min
      s('u2', 'Mail', 'NEUTRAL', 100),
    ]);
    const u1 = out.find((r) => r.userId === 'u1')!;
    const u2 = out.find((r) => r.userId === 'u2')!;

    expect(u1.avgActivityPct).toBe(60); // round((80+40+60)/3)
    expect(u1.activeMinutes).toBe(3); // 3 samples × 60s / 60
    expect(u1.byApp).toEqual({ Xcode: 2, Slack: 1 });
    expect(u1.byCategory).toEqual({ PRODUCTIVE: 2, NEUTRAL: 1 });

    expect(u2.avgActivityPct).toBe(100);
    expect(u2.activeMinutes).toBe(1);
    expect(u2.byApp).toEqual({ Mail: 1 });
    expect(u2.byCategory).toEqual({ NEUTRAL: 1 });
  });

  it('returns an empty array for no samples', () => {
    expect(aggregateSamples([])).toEqual([]);
  });

  it('rounds a .5 average up (Math.round)', () => {
    const out = aggregateSamples([s('u1', 'A', 'NEUTRAL', 40), s('u1', 'A', 'NEUTRAL', 41)]);
    expect(out[0]!.avgActivityPct).toBe(41); // round(40.5)
  });
});
