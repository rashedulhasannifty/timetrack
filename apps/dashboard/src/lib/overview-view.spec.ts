import { describe, it, expect } from 'vitest';
import {
  overviewKpis,
  topByHours,
  topByActivity,
  haventTracked,
  donutFromProjects,
} from './overview-view';
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

describe('topByHours', () => {
  it('sorts by trackedSeconds desc and normalizes pct to the top row', () => {
    const result = topByHours(team, 5);
    expect(result.map((r) => r.userId)).toEqual(['2', '1', '3']);
    expect(result[0]?.pct).toBe(100);
    expect(result[1]?.pct).toBe(50);
    expect(result[2]?.pct).toBe(0);
  });

  it('truncates to n', () => {
    expect(topByHours(team, 2)).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const copy = [...team];
    topByHours(team, 5);
    expect(team).toEqual(copy);
  });

  it('returns [] for empty team', () => {
    expect(topByHours([], 5)).toEqual([]);
  });

  it('defaults n to 5', () => {
    expect(topByHours(team)).toHaveLength(3);
  });
});

describe('topByActivity', () => {
  it('sorts by activityPct desc', () => {
    const result = topByActivity(team, 6);
    expect(result.map((r) => r.userId)).toEqual(['1', '2', '3']);
    expect(result.map((r) => r.activityPct)).toEqual([80, 40, 0]);
  });

  it('truncates to n', () => {
    expect(topByActivity(team, 2)).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const copy = [...team];
    topByActivity(team, 6);
    expect(team).toEqual(copy);
  });

  it('returns [] for empty team', () => {
    expect(topByActivity([], 6)).toEqual([]);
  });

  it('defaults n to 6', () => {
    expect(topByActivity(team)).toHaveLength(3);
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

describe('donutFromProjects', () => {
  const projects: ProjectSummaryRow[] = [
    { projectId: 'p1', name: 'Website', trackedSeconds: 3600 },
    { projectId: null, name: 'No project', trackedSeconds: 1800 },
    { projectId: 'p2', name: 'Empty Project', trackedSeconds: 0 },
  ];

  it('drops zero-second rows and sums totalSeconds from the kept rows', () => {
    const { segments, totalSeconds } = donutFromProjects(projects);
    expect(segments).toHaveLength(2);
    expect(totalSeconds).toBe(5400);
  });

  it('builds label/value/display per segment', () => {
    const { segments } = donutFromProjects(projects);
    expect(segments[0]).toMatchObject({ label: 'Website', value: 3600, display: '1h 0m' });
    expect(segments[1]).toMatchObject({ label: 'No project', value: 1800, display: '30m' });
  });

  it('derives color deterministically via projectColor, using "none" for null projectId', () => {
    const first = donutFromProjects(projects);
    const second = donutFromProjects(projects);
    expect(first.segments[0]?.color).toBe(second.segments[0]?.color);
    expect(typeof first.segments[0]?.color).toBe('string');
  });

  it('falls back to "none" for a null projectId', () => {
    const { segments } = donutFromProjects(projects);
    expect(segments[1]?.color).toBe(projectColor('none'));
  });

  it('returns [] segments and 0 totalSeconds for empty input', () => {
    expect(donutFromProjects([])).toEqual({ segments: [], totalSeconds: 0 });
  });
});

import {
  teamCategoryKpis,
  teamIdleKpi,
  trendsToHoursLine,
  trendsToProductivityBars,
  topByProductive,
  topByUnproductive,
  topByIdle,
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

describe('trendsToProductivityBars', () => {
  it('productive % of categorized per day', () => {
    const m = trendsToProductivityBars(trends);
    expect(m.values).toEqual([0, 75, 50]); // day1 0/0→0; day2 2700/3600; day3 1800/3600
    expect(m.dayLetters.length).toBe(3);
  });
});

describe('leaderboards', () => {
  it('topByProductive sorts desc', () => {
    expect(topByProductive(activity)).toEqual([
      { userId: '1', name: 'Ada', pct: 75 },
      { userId: '2', name: 'Bo', pct: 20 },
    ]);
  });
  it('topByUnproductive sorts desc', () => {
    expect(topByUnproductive(activity)[0]!).toEqual({ userId: '2', name: 'Bo', pct: 80 });
  });
  it('topByIdle sorts desc and carries minutes', () => {
    expect(topByIdle(activity)[0]!).toEqual({
      userId: '2',
      name: 'Bo',
      idlePct: 40,
      idleMinutes: 40,
    });
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

/* --- Redesign transforms --------------------------------------------------- */

import {
  previousRange,
  heroTotals,
  trendsToDayColumns,
  personRows,
  projectShares,
  attentionItems,
} from './overview-view';

describe('previousRange', () => {
  it('returns the equally long window immediately before', () => {
    const r = previousRange('2026-07-08T00:00:00.000Z', '2026-07-14T23:59:59.999Z');
    expect(r.to).toBe('2026-07-07T23:59:59.999Z');
    expect(r.from).toBe('2026-07-01T00:00:00.000Z');
  });

  it('never overlaps the current window', () => {
    const from = '2026-07-08T00:00:00.000Z';
    const r = previousRange(from, '2026-07-14T23:59:59.999Z');
    expect(Date.parse(r.to)).toBeLessThan(Date.parse(from));
  });
});

describe('heroTotals', () => {
  const cur: TeamSummaryRow[] = [
    { userId: '1', name: 'A', trackedSeconds: 3600, activityPct: 0 },
    { userId: '2', name: 'B', trackedSeconds: 7200, activityPct: 0 },
  ];

  it('sums the current window', () => {
    expect(heroTotals(cur, null).totalSeconds).toBe(10_800);
  });

  it('omits the delta when there is no previous window', () => {
    expect(heroTotals(cur, null).deltaPct).toBeNull();
  });

  it('omits the delta rather than dividing by a zero prior total', () => {
    expect(heroTotals(cur, []).deltaPct).toBeNull();
    const zeroed: TeamSummaryRow[] = [
      { userId: '1', name: 'A', trackedSeconds: 0, activityPct: 0 },
    ];
    expect(heroTotals(cur, zeroed).deltaPct).toBeNull();
  });

  it('reports a percentage change against the previous total', () => {
    const prev: TeamSummaryRow[] = [
      { userId: '1', name: 'A', trackedSeconds: 7200, activityPct: 0 },
    ];
    expect(heroTotals(cur, prev).deltaPct).toBe(50);
  });

  it('reports a negative delta when time fell', () => {
    const prev: TeamSummaryRow[] = [
      { userId: '1', name: 'A', trackedSeconds: 21_600, activityPct: 0 },
    ];
    expect(heroTotals(cur, prev).deltaPct).toBe(-50);
  });
});

describe('trendsToDayColumns', () => {
  // 2026-07-04 is a Saturday, 2026-07-05 a Sunday.
  const trends: TeamTrends = {
    from: '',
    to: '',
    days: [
      {
        day: '2026-07-03',
        trackedSeconds: 36_000,
        productiveSeconds: 18_000,
        neutralSeconds: 9_000,
        unproductiveSeconds: 9_000,
      },
      {
        day: '2026-07-04',
        trackedSeconds: 3_600,
        productiveSeconds: 3_600,
        neutralSeconds: 0,
        unproductiveSeconds: 0,
      },
      {
        day: '2026-07-05',
        trackedSeconds: 0,
        productiveSeconds: 0,
        neutralSeconds: 0,
        unproductiveSeconds: 0,
      },
    ],
  };

  it('scales bar heights against the tallest day', () => {
    const m = trendsToDayColumns(trends);
    expect(m.peakHours).toBe(10);
    expect(m.columns[0]!.heightPct).toBe(100);
    expect(m.columns[1]!.heightPct).toBe(10);
  });

  it('flags weekends', () => {
    const m = trendsToDayColumns(trends);
    expect(m.columns.map((c) => c.weekend)).toEqual([false, true, true]);
  });

  it('averages only the days that had tracked time', () => {
    // (10 + 1) / 2 — the untracked Sunday must not drag the average toward zero.
    expect(trendsToDayColumns(trends).averageHours).toBe(5.5);
  });

  it('reports each day’s productive share of categorized time', () => {
    expect(trendsToDayColumns(trends).columns[0]!.productivePct).toBe(50);
  });

  it('survives an empty range', () => {
    const m = trendsToDayColumns({ from: '', to: '', days: [] });
    expect(m.columns).toEqual([]);
    expect(m.peakHours).toBe(0);
    expect(m.averageHours).toBe(0);
    expect(m.axisLabels).toEqual([]);
  });
});

describe('personRows', () => {
  const activity: TeamActivity = {
    from: '',
    to: '',
    rows: [
      {
        userId: '1',
        name: 'Alice',
        activeMinutes: 50,
        productivePct: 70,
        neutralPct: 20,
        unproductivePct: 10,
        idleMinutes: 10,
        idlePct: 17,
      },
    ],
  };

  it('sorts by tracked time, descending', () => {
    expect(personRows(team, activity, overview).map((r) => r.name)).toEqual([
      'Bob',
      'Alice',
      'Charlie',
    ]);
  });

  it('widens a row with its activity mix when present', () => {
    const alice = personRows(team, activity, overview).find((r) => r.name === 'Alice')!;
    expect(alice.productivePct).toBe(70);
    expect(alice.idleMinutes).toBe(10);
  });

  it('leaves the mix null rather than zero when team-activity has no row', () => {
    const bob = personRows(team, activity, overview).find((r) => r.name === 'Bob')!;
    expect(bob.productivePct).toBeNull();
    expect(bob.idlePct).toBeNull();
  });

  it('keeps everyone when the activity call degraded to empty', () => {
    const rows = personRows(team, { from: '', to: '', rows: [] }, overview);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.productivePct === null)).toBe(true);
  });

  it('marks who is tracking right now', () => {
    const rows = personRows(team, activity, overview);
    expect(rows.find((r) => r.name === 'Alice')!.live).toBe(true);
    expect(rows.find((r) => r.name === 'Bob')!.live).toBe(false);
  });
});

describe('projectShares', () => {
  const rows: ProjectSummaryRow[] = [
    { projectId: 'p1', name: 'Alpha', trackedSeconds: 7200 },
    { projectId: null, name: 'No project', trackedSeconds: 1800 },
    { projectId: 'p2', name: 'Beta', trackedSeconds: 1000 },
    { projectId: 'p3', name: 'Dormant', trackedSeconds: 0 },
  ];

  it('divides by every row including the no-project bucket, so shares total 100', () => {
    const { shares } = projectShares(rows);
    const sum = shares.reduce((s, x) => s + x.sharePct, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('drops rows with no tracked time but still counts the total', () => {
    const { shares, totalSeconds } = projectShares(rows);
    expect(shares.map((s) => s.name)).toEqual(['Alpha', 'No project', 'Beta']);
    expect(totalSeconds).toBe(10_000);
  });

  it('survives an empty range without dividing by zero', () => {
    expect(projectShares([])).toEqual({ shares: [], totalSeconds: 0 });
  });
});

describe('attentionItems', () => {
  const activity: TeamActivity = {
    from: '',
    to: '',
    rows: [
      {
        userId: '1',
        name: 'Alice',
        activeMinutes: 50,
        productivePct: 70,
        neutralPct: 20,
        unproductivePct: 10,
        idleMinutes: 57,
        idlePct: 12,
      },
      {
        userId: '2',
        name: 'Bob',
        activeMinutes: 90,
        productivePct: 80,
        neutralPct: 15,
        unproductivePct: 5,
        idleMinutes: 2,
        idlePct: 2,
      },
    ],
  };
  const apps: TeamAppUsage = {
    from: '',
    to: '',
    rows: [
      { appName: 'Xcode', seconds: 100, category: 'PRODUCTIVE' },
      { appName: 'Chrome', seconds: 90, category: 'NEUTRAL' },
      { appName: 'weather.com', seconds: 10, category: 'NEUTRAL' },
    ],
  };
  const base = { overview, activity, apps, pendingApprovals: 2 };

  it('surfaces the people who have not tracked today', () => {
    const item = attentionItems(base).find((i) => i.id === 'untracked')!;
    expect(item.title).toContain('2 people');
    expect(item.tone).toBe('bad');
  });

  it('words the untracked item as today, not as never', () => {
    // teamOverview reports a single day; claiming "never tracked" would send a manager
    // after the wrong person.
    expect(attentionItems(base).find((i) => i.id === 'untracked')!.title).toContain('today');
    expect(attentionItems(base).find((i) => i.id === 'untracked')!.title).not.toContain('never');
  });

  it('links pending approvals straight to the pending tab', () => {
    const item = attentionItems(base).find((i) => i.id === 'approvals')!;
    expect(item.title).toContain('2 timesheets');
    expect(item.href).toBe('/approvals?status=PENDING');
  });

  it('omits approvals when none are pending', () => {
    expect(attentionItems({ ...base, pendingApprovals: 0 }).some((i) => i.id === 'approvals')).toBe(
      false,
    );
  });

  it('surfaces only the worst idler, and only over the threshold', () => {
    const item = attentionItems(base).find((i) => i.id === 'idle')!;
    expect(item.title).toContain('Alice');
    expect(item.href).toBe('/people/1');
    expect(attentionItems({ ...base, idleThresholdPct: 20 }).some((i) => i.id === 'idle')).toBe(
      false,
    );
  });

  it('scopes the unrated claim to the top apps it can actually see', () => {
    const item = attentionItems(base).find((i) => i.id === 'unrated')!;
    expect(item.title).toBe('2 of the top apps are unrated');
  });

  it('returns nothing when there is nothing to do', () => {
    expect(
      attentionItems({
        overview: [{ userId: '1', name: 'Alice', tracking: true, trackedSecondsToday: 60 }],
        activity: { from: '', to: '', rows: [] },
        apps: { from: '', to: '', rows: [] },
        pendingApprovals: 0,
      }),
    ).toEqual([]);
  });
});
