import { describe, it, expect } from 'vitest';
import { dayAppUsage } from './day-app-usage';

const usage = (rows: { appName: string; seconds: number }[]) => ({
  from: '2026-08-18T00:00:00.000Z',
  to: '2026-08-18T23:59:59.999Z',
  rows: rows.map((r) => ({ ...r, category: 'NEUTRAL' as const })),
});

describe('dayAppUsage', () => {
  it('sorts longest first regardless of the order the API returned', () => {
    const items = dayAppUsage(
      usage([
        { appName: 'Slack', seconds: 600 },
        { appName: 'Code', seconds: 7200 },
        { appName: 'Chrome', seconds: 3600 },
      ]),
    );
    expect(items.map((i) => i.appName)).toEqual(['Code', 'Chrome', 'Slack']);
  });

  it('scales the bar against the busiest app, not the total', () => {
    // 7200 + 3600 = 10800s. If pct were a share of the total, Code would be 67, not 100.
    // The API returns only the top N apps, so their sum is not the day and a share would lie.
    const items = dayAppUsage(
      usage([
        { appName: 'Code', seconds: 7200 },
        { appName: 'Chrome', seconds: 3600 },
      ]),
    );
    expect(items[0]?.pct).toBe(100);
    expect(items[1]?.pct).toBe(50);
  });

  it('keeps the seconds untouched so the printed time stays true', () => {
    const items = dayAppUsage(usage([{ appName: 'Code', seconds: 7261 }]));
    expect(items[0]?.seconds).toBe(7261);
  });

  it('caps the list and takes the longest, not the first', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ appName: `App${i}`, seconds: i * 60 }));
    const items = dayAppUsage(usage(rows), 3);
    expect(items.map((i) => i.appName)).toEqual(['App19', 'App18', 'App17']);
  });

  it('returns nothing for a day with no samples instead of dividing by zero', () => {
    expect(dayAppUsage(usage([]))).toEqual([]);
  });
});
