import { describe, it, expect } from 'vitest';
import { overviewKpis, haventTracked, peopleTableRows, projectBars } from './overview-view';
import type { TeamSummaryRow, TeamOverviewRow, ProjectSummaryRow } from '@timetrack/contracts';
import { projectColor } from './project-color';

const team: TeamSummaryRow[] = [
  { userId: '1', name: 'Alice', trackedSeconds: 3600, activityPct: 80 },
  { userId: '2', name: 'Bob', trackedSeconds: 7200, activityPct: 40 },
  { userId: '3', name: 'Charlie', trackedSeconds: 0, activityPct: 0 },
];

const overview: TeamOverviewRow[] = [
  { userId: '1', name: 'Alice', tracking: true, trackedSecondsToday: 1800 },
  { userId: '2', name: 'Bob', tracking: false, trackedSecondsToday: 0 },
  { userId: '3', name: 'Charlie', tracking: true, trackedSecondsToday: 0 },
];

describe('overviewKpis', () => {
  it('sums trackedSeconds, counts active users and tracking rows', () => {
    expect(overviewKpis(team, overview)).toEqual({
      totalSeconds: 10800,
      activeUsers: 2,
      tracking: 2,
    });
  });

  it('returns zeros for empty inputs', () => {
    expect(overviewKpis([], [])).toEqual({ totalSeconds: 0, activeUsers: 0, tracking: 0 });
  });
});

describe('haventTracked', () => {
  it('returns rows with trackedSecondsToday === 0', () => {
    expect(haventTracked(overview).map((r) => r.userId)).toEqual(['2', '3']);
  });

  it('returns [] when everyone has tracked', () => {
    const allTracked: TeamOverviewRow[] = [
      { userId: '1', name: 'Alice', tracking: true, trackedSecondsToday: 100 },
    ];
    expect(haventTracked(allTracked)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(haventTracked([])).toEqual([]);
  });
});

import {
  teamCategoryKpis,
  teamIdleKpi,
  trendsToHoursLine,
  appUsageByCategory,
} from './overview-view';
import type { TeamTrends, TeamActivity, TeamAppUsage } from '@timetrack/contracts';

const trends: TeamTrends = {
  from: '2026-07-11T00:00:00.000Z',
  to: '2026-07-13T00:00:00.000Z',
  days: [
    {
      day: '2026-07-11',
      trackedSeconds: 0,
      productiveSeconds: 0,
      neutralSeconds: 0,
      unproductiveSeconds: 0,
    },
    {
      day: '2026-07-12',
      trackedSeconds: 3600,
      productiveSeconds: 2700,
      neutralSeconds: 900,
      unproductiveSeconds: 0,
    },
    {
      day: '2026-07-13',
      trackedSeconds: 7200,
      productiveSeconds: 1800,
      neutralSeconds: 0,
      unproductiveSeconds: 1800,
    },
  ],
};
const activity: TeamActivity = {
  from: trends.from,
  to: trends.to,
  rows: [
    {
      userId: '1',
      name: 'Ada',
      activeMinutes: 90,
      productivePct: 75,
      neutralPct: 25,
      unproductivePct: 0,
      idleMinutes: 10,
      idlePct: 10,
    },
    {
      userId: '2',
      name: 'Bo',
      activeMinutes: 60,
      productivePct: 20,
      neutralPct: 0,
      unproductivePct: 80,
      idleMinutes: 40,
      idlePct: 40,
    },
  ],
};
const appUsage: TeamAppUsage = {
  from: trends.from,
  to: trends.to,
  rows: [
    { appName: 'Xcode', seconds: 3600, category: 'PRODUCTIVE' },
    { appName: 'Slack', seconds: 1800, category: 'NEUTRAL' },
    { appName: 'YouTube', seconds: 600, category: 'UNPRODUCTIVE' },
  ],
};

describe('teamCategoryKpis', () => {
  it('sums category seconds across days and rounds pcts', () => {
    // prod=4500 neut=900 unprod=1800 total=7200 → prod 63, unprod 25
    expect(teamCategoryKpis(trends)).toEqual({ productivePct: 63, unproductivePct: 25 });
  });
  it('returns zeros when no categorized time', () => {
    expect(teamCategoryKpis({ ...trends, days: [] })).toEqual({
      productivePct: 0,
      unproductivePct: 0,
    });
  });
});

describe('teamIdleKpi', () => {
  it('idle / (idle + active) across rows', () => {
    // idle=50 active=150 → 50/200 = 25
    expect(teamIdleKpi(activity)).toEqual({ idlePct: 25 });
  });
  it('zero when no minutes', () => {
    expect(teamIdleKpi({ ...activity, rows: [] })).toEqual({ idlePct: 0 });
  });
});

describe('trendsToHoursLine', () => {
  it('maps tracked hours, a multiple-of-6 max, thirds axis, day letters and labels', () => {
    const m = trendsToHoursLine(trends);
    expect(m.values).toEqual([0, 1, 2]); // seconds/3600, 1dp
    expect(m.max).toBe(6); // ceil(2/6)*6, min 6
    expect(m.axis).toEqual(['6', '4', '2', '0']); // niceMax, *2/3, /3, 0
    expect(m.dayLetters).toEqual([
      { letter: 'S', weekend: true }, // 2026-07-11 is a Saturday (UTC)
      { letter: 'S', weekend: true }, // 2026-07-12 Sunday
      { letter: 'M', weekend: false }, // 2026-07-13 Monday
    ]);
    expect(m.labels).toEqual(['Jul 11', 'Jul 12', 'Jul 13']);
  });
});

describe('appUsageByCategory', () => {
  it('splits by category and normalizes pct within each list', () => {
    const r = appUsageByCategory(appUsage);
    expect(r.topUsed.map((i) => i.appName)).toEqual(['Xcode', 'Slack', 'YouTube']);
    expect(r.topUsed[0]!.pct).toBe(100); // 3600 is the max in topUsed
    expect(r.topUsed[1]!.pct).toBe(50); // 1800/3600
    expect(r.unproductive.map((i) => i.appName)).toEqual(['YouTube']);
    expect(r.unrated.map((i) => i.appName)).toEqual(['Slack']);
  });
});

describe('peopleTableRows', () => {
  const summary: TeamSummaryRow[] = [
    { userId: '1', name: 'Ada', trackedSeconds: 3600, activityPct: 80 },
    { userId: '2', name: 'Bo', trackedSeconds: 7200, activityPct: 40 },
    { userId: '9', name: 'Zed', trackedSeconds: 1800, activityPct: 10 },
  ];
  const live: TeamOverviewRow[] = [
    { userId: '2', name: 'Bo', tracking: true, trackedSecondsToday: 60 },
    { userId: '1', name: 'Ada', tracking: false, trackedSecondsToday: 0 },
  ];

  it('joins the summary, activity and live rollups on userId, tracked time descending', () => {
    const rows = peopleTableRows(summary, activity.rows, live);
    expect(rows.map((r) => r.name)).toEqual(['Bo', 'Ada', 'Zed']);
    expect(rows[0]).toEqual({
      userId: '2',
      name: 'Bo',
      trackedSeconds: 7200,
      activityPct: 40,
      productivePct: 20,
      unproductivePct: 80,
      idlePct: 40,
      idleMinutes: 40,
      tracking: true,
    });
  });

  it('keeps a person missing from the activity rollup, with zeroed category columns', () => {
    const zed = peopleTableRows(summary, activity.rows, live).find((r) => r.userId === '9');
    expect(zed).toBeDefined();
    expect(zed!.trackedSeconds).toBe(1800);
    expect(zed!.productivePct).toBe(0);
    expect(zed!.idleMinutes).toBe(0);
    expect(zed!.tracking).toBe(false);
  });

  it('breaks a tracked-time tie on name', () => {
    const tied: TeamSummaryRow[] = [
      { userId: 'b', name: 'Bea', trackedSeconds: 60, activityPct: 0 },
      { userId: 'a', name: 'Abe', trackedSeconds: 60, activityPct: 0 },
    ];
    expect(peopleTableRows(tied, [], []).map((r) => r.name)).toEqual(['Abe', 'Bea']);
  });

  it('is empty when the summary is', () => {
    expect(peopleTableRows([], activity.rows, live)).toEqual([]);
  });
});

describe('projectBars', () => {
  const rows: ProjectSummaryRow[] = [
    { projectId: '11111111-1111-4111-8111-111111111111', name: 'Apollo', trackedSeconds: 7200 },
    { projectId: '22222222-2222-4222-8222-222222222222', name: 'Borealis', trackedSeconds: 1800 },
    { projectId: '33333333-3333-4333-8333-333333333333', name: 'Cinder', trackedSeconds: 0 },
    { projectId: null, name: 'No project', trackedSeconds: 1000 },
  ];

  it('labels share of the range but sizes the bar against the leader', () => {
    const bars = projectBars(rows);
    expect(bars.map((b) => b.name)).toEqual(['Apollo', 'Borealis', 'No project']);
    expect(bars[0]!.sharePct).toBe(72); // 7200 / 10000
    expect(bars[0]!.widthPct).toBe(100); // the leader fills the track
    expect(bars[1]!.widthPct).toBe(25); // 1800 / 7200
  });

  it('drops zero-second projects and colours the null bucket deterministically', () => {
    const bars = projectBars(rows);
    expect(bars.some((b) => b.name === 'Cinder')).toBe(false);
    expect(bars.find((b) => b.key === 'none')!.color).toBe(projectColor('none'));
  });

  it('caps the list and survives an empty range', () => {
    expect(projectBars(rows, 1).map((b) => b.name)).toEqual(['Apollo']);
    expect(projectBars([])).toEqual([]);
  });
});
