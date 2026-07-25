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
