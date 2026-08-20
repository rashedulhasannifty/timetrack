import { describe, it, expect } from 'vitest';
import { personDayView, resolveDayDate } from './person-day-view';
import type { TimeEntry, ActivitySample, Screenshot, Project } from '@timetrack/contracts';

const D = '2026-07-13';
const iso = (h: number, m = 0) =>
  `${D}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const entry = (id: string, sh: number, eh: number | null, note = 'work'): TimeEntry =>
  ({
    id,
    userId: 'u1',
    projectId: null,
    taskId: null,
    startTime: iso(sh),
    endTime: eh === null ? null : iso(eh),
    source: 'MANUAL',
    note,
  }) as TimeEntry;
const base = { date: D, isSelf: true, subjectName: 'You', samples: [], screenshots: [] };

describe('personDayView — core', () => {
  it('derives the window from data, snapped to the hour with a 4h minimum', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(new Date(vm.window.startMs).toISOString()).toBe(iso(9));
    // 09:00 tracked one hour → window must be >= 4h, so end extends to 13:00
    expect((vm.window.endMs - vm.window.startMs) / 3_600_000).toBe(4);
  });

  it('empty day falls back to 09:00–18:00', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [] });
    expect(new Date(vm.window.startMs).toISOString()).toBe(iso(9));
    expect(new Date(vm.window.endMs).toISOString()).toBe(iso(18));
    expect(vm.stats.trackedSeconds).toBe(0);
  });

  it('tracked = sum of entry durations; untracked = window minus tracked (gaps)', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 12), entry('b', 13, 17)],
    });
    expect(vm.stats.trackedSeconds).toBe(7 * 3600); // 3h + 4h
    // window 09:00–17:00 = 8h, tracked 7h → untracked 1h
    expect(vm.stats.untrackedSeconds).toBe(3600);
  });

  it('counts an open entry to now on today and flags recordingNow', () => {
    const now = new Date('2026-07-13T15:30:00.000Z');
    const vm = personDayView({
      ...base,
      date: '2026-07-13',
      now,
      entries: [entry('a', 14, null)],
      // recordingNow now requires a recent activity sample as proof of life, not just an
      // open entry — a crashed/shut-down client can leave one behind (spec §4.3).
      samples: [sample(15, 29, 'NEUTRAL', 50)],
    });
    expect(vm.recordingNow).toBe(true);
    expect(vm.isToday).toBe(true);
    expect(vm.stats.trackedSeconds).toBe(90 * 60); // 14:00 → 15:30
  });

  it('activePct is null with no samples', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(vm.stats.activePct).toBeNull();
  });

  it('merges overlapping entries so trackedSeconds is not double-counted', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      // 09:00–13:00 and 11:00–15:00 overlap 11:00–13:00; merged span is 09:00–15:00 = 6h.
      entries: [entry('a', 9, 13), entry('b', 11, 15)],
    });
    expect(vm.stats.trackedSeconds).toBe(6 * 3600); // merged, not the naive 4h+4h=8h
    // window is exactly the merged tracked span (09:00–15:00), so there's no gap.
    expect(vm.stats.untrackedSeconds).toBe(0);
  });
});

const sample = (h: number, m: number, cat: string, pct: number): ActivitySample =>
  ({
    id: `s${h}${m}`,
    userId: 'u1',
    timestamp: iso(h, m),
    appName: 'x',
    windowTitle: null,
    activityPct: pct,
    category: cat,
  }) as ActivitySample;

describe('personDayView — ribbon', () => {
  it('tiles a tracked entry into contiguous same-category segments positioned by % of window', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)], // fills the 4h min window exactly (09–13)
      samples: [
        sample(9, 0, 'PRODUCTIVE', 80),
        sample(9, 30, 'PRODUCTIVE', 60),
        sample(10, 0, 'UNPRODUCTIVE', 10),
      ],
    });
    // productive 09:00–10:00, then unproductive 10:00–13:00 → two segments.
    expect(vm.ribbon.tracked).toHaveLength(2);
    expect(vm.ribbon.tracked[0]).toMatchObject({ category: 'PRODUCTIVE', startPct: 0 });
    expect(Math.round(vm.ribbon.tracked[0]!.widthPct)).toBe(25); // 1h of 4h
    expect(vm.ribbon.tracked[1]!.category).toBe('UNPRODUCTIVE');
    expect(Math.round(vm.ribbon.tracked[1]!.startPct)).toBe(25);
    expect(Math.round(vm.ribbon.tracked[1]!.widthPct)).toBe(75); // 3h of 4h
  });

  it('surfaces a brief unproductive stretch inside a neutral entry as its own segment', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)],
      samples: [
        sample(9, 0, 'NEUTRAL', 50),
        sample(11, 0, 'UNPRODUCTIVE', 20),
        sample(11, 30, 'NEUTRAL', 40),
      ],
    });
    // neutral 09–11, unproductive 11:00–11:30, neutral 11:30–13 → 3 segments.
    expect(vm.ribbon.tracked.map((b) => b.category)).toEqual([
      'NEUTRAL',
      'UNPRODUCTIVE',
      'NEUTRAL',
    ]);
  });

  it('renders an entry with no samples as one neutral segment spanning the entry', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 13)] });
    expect(vm.ribbon.tracked).toHaveLength(1);
    expect(vm.ribbon.tracked[0]).toMatchObject({ category: 'NEUTRAL', startPct: 0 });
    expect(Math.round(vm.ribbon.tracked[0]!.widthPct)).toBe(100);
  });

  it('emits an untracked gap between two blocks', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 12), entry('b', 13, 17)],
    });
    expect(vm.ribbon.untracked.length).toBe(1); // the 12:00–13:00 gap
  });

  it('derives hour ticks and per-hour activity buckets', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)],
      samples: [sample(9, 0, 'NEUTRAL', 50)],
    });
    expect(vm.ribbon.hourTicks.map((t) => t.label)).toEqual(['09', '10', '11', '12', '13']);
    expect(vm.activityBuckets[0]).toMatchObject({
      label: '09',
      activityPct: 50,
      category: 'NEUTRAL',
    });
    expect(vm.activityBuckets[1]!.category).toBe('UNTRACKED'); // 10:00 hour has no samples
  });

  it('places a capture mark at the screenshot time', () => {
    const shot = {
      id: 'sh1',
      userId: 'u1',
      timestamp: iso(11),
      storageKey: 'k',
      thumbnailKey: null,
      blurred: false,
      status: 'READY',
      redactedReason: null,
    } as Screenshot;
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)],
      screenshots: [shot],
    });
    expect(vm.ribbon.captures).toHaveLength(1);
    expect(Math.round(vm.ribbon.captures[0]!.atPct)).toBe(50); // 11:00 is midpoint of 09–13
  });
});

describe('personDayView — entry labels', () => {
  // An auto/manual entry carries a projectId/taskId but no free-text note.
  const tagged = (over: Partial<TimeEntry>): TimeEntry =>
    ({
      id: 'e1',
      userId: 'u1',
      projectId: null,
      taskId: null,
      startTime: iso(9),
      endTime: iso(10),
      source: 'AUTO',
      note: undefined,
      ...over,
    }) as TimeEntry;
  const projects = [
    {
      id: 'p1',
      teamId: 't1',
      name: 'Energy Reporting',
      color: null,
      archived: false,
      tasks: [{ id: 'k1', projectId: 'p1', name: 'Fix Lighting Forms', archived: false }],
    },
  ] as Project[];
  const label = (over: Partial<TimeEntry>): string =>
    personDayView({ ...base, now: new Date(iso(20)), entries: [tagged(over)], projects })
      .entries[0]!.label;

  it('names a note-less entry by its project', () => {
    expect(label({ projectId: 'p1' })).toBe('Energy Reporting');
  });

  it('appends the task when the entry has one ("Project · Task")', () => {
    expect(label({ projectId: 'p1', taskId: 'k1' })).toBe('Energy Reporting · Fix Lighting Forms');
  });

  it('keeps a user-authored note in preference to the project name', () => {
    expect(label({ projectId: 'p1', note: 'refactor' })).toBe('refactor');
  });

  it('falls back to "Untitled entry" when the project is unresolvable', () => {
    expect(label({ projectId: 'gone' })).toBe('Untitled entry');
    expect(label({})).toBe('Untitled entry');
  });

  it('propagates the resolved name to the ribbon block label too', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [tagged({ projectId: 'p1' })],
      projects,
    });
    expect(vm.ribbon.tracked[0]!.label).toBe('Energy Reporting');
  });
});

describe('resolveDayDate', () => {
  const now = new Date('2026-07-13T20:00:00.000Z');

  it('keeps a valid date', () => {
    expect(resolveDayDate('2026-07-01', now)).toBe('2026-07-01');
  });

  it('falls back to today when raw is undefined', () => {
    expect(resolveDayDate(undefined, now)).toBe('2026-07-13');
  });

  it.each(['2026-7-1', 'garbage'])('falls back to today on bad format %s', (raw) => {
    expect(resolveDayDate(raw, now)).toBe('2026-07-13');
  });

  it.each(['2026-13-45', '2026-02-30'])('falls back to today on impossible date %s', (raw) => {
    expect(resolveDayDate(raw, now)).toBe('2026-07-13');
  });
});

describe('personDayView — open-entry liveness', () => {
  it('is not recording when the newest sample has gone stale', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
      samples: [sample(9, 0, 'NEUTRAL', 50)], // an hour old
    });
    expect(vm.recordingNow).toBe(false);
  });

  it('is recording while samples keep arriving', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
      samples: [sample(9, 59, 'NEUTRAL', 50)],
    });
    expect(vm.recordingNow).toBe(true);
  });

  it("stops growing a stale open entry's duration", () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
      samples: [sample(9, 0, 'NEUTRAL', 50)],
    });
    // 08:00 -> 09:00 heartbeat + 300s freshness = 3900s, NOT the 7200s to `now`.
    expect(vm.entries[0]?.durationSeconds).toBeLessThanOrEqual(4000);
  });

  it('runs a live entry to now', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
      samples: [sample(9, 59, 'NEUTRAL', 50)],
    });
    expect(vm.entries[0]?.durationSeconds).toBe(7200);
  });

  // RULING A (fix round 1): absence of samples is absence of evidence, not evidence of
  // death. A user who hasn't satisfied `monitoringAckAt` produces NO activity samples at
  // all — capture is gated off entirely — yet can still track time manually. Freezing their
  // duration to zero (the original fix's behavior) would misreport every entry they log.
  it('reports a real growing duration and recordingNow when there are no samples at all', () => {
    const vm = personDayView({
      ...base, // base already carries samples: []
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
    });
    expect(vm.recordingNow).toBe(true);
    expect(vm.entries[0]?.durationSeconds).toBe(7200); // 08:00 -> 10:00, unclamped
  });

  // RULING C (fix round 1): the per-entry/per-block "running" label must not contradict the
  // top-level recordingNow pill — a stale open entry's duration is frozen, so its row and
  // ribbon tooltip must stop claiming "running" too.
  it('is not marked running once stale, even though it is still open', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10)),
      entries: [entry('a', 8, null)],
      samples: [sample(9, 0, 'NEUTRAL', 50)], // an hour old
    });
    expect(vm.entries[0]?.running).toBe(false);
    expect(vm.ribbon.tracked.at(-1)?.running).toBe(false);
  });
});
