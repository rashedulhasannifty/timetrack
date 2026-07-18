import { describe, it, expect } from 'vitest';
import type { ActivityDailySummary } from '@timetrack/contracts';
import {
  activitySummaryWindow,
  toDailyActivityPoints,
  aggregateApps,
  aggregateCategories,
  totalActiveMinutes,
} from './activity-summary-view';

const summary = (over: Partial<ActivityDailySummary>): ActivityDailySummary => ({
  userId: '019797a0-0000-7000-8000-0000000000aa',
  day: '2026-07-17',
  avgActivityPct: 50,
  activeMinutes: 120,
  byApp: {},
  byCategory: {},
  ...over,
});

describe('activitySummaryWindow', () => {
  it('returns the 7 UTC days ending yesterday', () => {
    expect(activitySummaryWindow(new Date('2026-07-18T09:30:00.000Z'))).toEqual({
      from: '2026-07-11',
      to: '2026-07-17',
    });
  });

  it('honors a custom day count', () => {
    expect(activitySummaryWindow(new Date('2026-07-18T00:00:00.000Z'), 3)).toEqual({
      from: '2026-07-15',
      to: '2026-07-17',
    });
  });
});

describe('toDailyActivityPoints', () => {
  it('emits one zero-filled point per day in the window, labelled MM-DD', () => {
    const points = toDailyActivityPoints(
      [
        summary({ day: '2026-07-12', avgActivityPct: 80 }),
        summary({ day: '2026-07-14', avgActivityPct: 30 }),
      ],
      '2026-07-11',
      '2026-07-14',
    );
    expect(points).toEqual([
      { label: '07-11', activityPct: 0 },
      { label: '07-12', activityPct: 80 },
      { label: '07-13', activityPct: 0 },
      { label: '07-14', activityPct: 30 },
    ]);
  });
});

describe('aggregateApps', () => {
  it('sums minutes per app across days, busiest first, pct as share of the max', () => {
    const apps = aggregateApps([
      summary({ byApp: { Code: 60, Slack: 30 } }),
      summary({ byApp: { Code: 60, Chrome: 20 } }),
    ]);
    expect(apps).toEqual([
      { name: 'Code', minutes: 120, pct: 100 },
      { name: 'Slack', minutes: 30, pct: 25 },
      { name: 'Chrome', minutes: 20, pct: 17 },
    ]);
  });

  it('caps at topN and breaks minute ties by name', () => {
    const apps = aggregateApps([summary({ byApp: { B: 10, A: 10, C: 5 } })], 2);
    expect(apps.map((a) => a.name)).toEqual(['A', 'B']);
  });

  it('returns [] for no summaries', () => {
    expect(aggregateApps([])).toEqual([]);
  });
});

describe('aggregateCategories', () => {
  it('sums the three categories in fixed order with total shares', () => {
    const mix = aggregateCategories([
      summary({ byCategory: { PRODUCTIVE: 60, NEUTRAL: 30 } }),
      summary({ byCategory: { PRODUCTIVE: 20, UNPRODUCTIVE: 40 } }),
    ]);
    expect(mix).toEqual([
      { category: 'PRODUCTIVE', minutes: 80, pct: 53 },
      { category: 'NEUTRAL', minutes: 30, pct: 20 },
      { category: 'UNPRODUCTIVE', minutes: 40, pct: 27 },
    ]);
  });

  it('is all-zero for no summaries', () => {
    expect(aggregateCategories([])).toEqual([
      { category: 'PRODUCTIVE', minutes: 0, pct: 0 },
      { category: 'NEUTRAL', minutes: 0, pct: 0 },
      { category: 'UNPRODUCTIVE', minutes: 0, pct: 0 },
    ]);
  });
});

describe('totalActiveMinutes', () => {
  it('sums activeMinutes across the window', () => {
    expect(
      totalActiveMinutes([summary({ activeMinutes: 120 }), summary({ activeMinutes: 45 })]),
    ).toBe(165);
  });

  it('is 0 for no summaries', () => {
    expect(totalActiveMinutes([])).toBe(0);
  });
});
