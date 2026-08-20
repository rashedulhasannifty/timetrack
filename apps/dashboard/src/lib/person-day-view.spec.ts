import { describe, it, expect } from 'vitest';
import { dayRangeFor, personDayView, resolveDayDate, weekStrip } from './person-day-view';
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
  it('derives the window from data, snapped to the hour with an 8h minimum', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(new Date(vm.window.startMs).toISOString()).toBe(iso(9));
    // 09:00 tracked one hour → window must be >= 8h, so the end extends to 17:00. The padding
    // is a DRAWING concern; untrackedSeconds is measured against elapsed time, not against it.
    expect((vm.window.endMs - vm.window.startMs) / 3_600_000).toBe(8);
  });

  it('empty day falls back to 09:00–18:00 Dhaka', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [] });
    // Dhaka midnight on D is 2026-07-12T18:00:00.000Z; +9h/+18h from there.
    expect(new Date(vm.window.startMs).toISOString()).toBe('2026-07-13T03:00:00.000Z');
    expect(new Date(vm.window.endMs).toISOString()).toBe('2026-07-13T12:00:00.000Z');
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
    const vm = personDayView({ ...base, date: '2026-07-13', now, entries: [entry('a', 14, null)] });
    expect(vm.recordingNow).toBe(true);
    expect(vm.isToday).toBe(true);
    expect(vm.stats.trackedSeconds).toBe(90 * 60); // 14:00 → 15:30
  });

  it('activePct is null with no samples', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(vm.stats.activePct).toBeNull();
  });

  /**
   * REGRESSION. The window is padded out to the 8h minimum so the ribbon has a readable scale,
   * and on TODAY that padding runs into the future. Measuring untracked against the padded
   * window reported hours that had not happened yet — the reported symptom was "Untracked 3h23m"
   * at 4am, most of it still to come.
   *
   * Here: one hour tracked 09:00–10:00, the window padded to 09:00–17:00, and it is now 11:00.
   * Only two hours have elapsed, one of them tracked, so exactly one hour is untracked. Against
   * the padded window it would have read 7h.
   */
  it('measures untracked against elapsed time, not the padding, on today', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(11)), // 17:00 Dhaka on D — the same Dhaka day, mid-window
      entries: [entry('a', 9, 10)],
    });
    expect((vm.window.endMs - vm.window.startMs) / 3_600_000).toBe(8); // still drawn at 8h
    expect(vm.stats.trackedSeconds).toBe(3600);
    expect(vm.stats.untrackedSeconds).toBe(3600);
  });

  /** Never negative: nothing has elapsed yet at the very start of the window. */
  it('reports no untracked time before the window has begun', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(9)),
      entries: [entry('a', 9, 10)],
    });
    expect(vm.stats.untrackedSeconds).toBe(0);
  });

  /** A past day is unaffected — every hour of its window has elapsed by definition. */
  it('leaves a past day measured against the whole window', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)), // 02:00 Dhaka on the NEXT day, so D is in the past
      entries: [entry('a', 9, 10)],
    });
    expect(vm.stats.untrackedSeconds).toBe(7 * 3600); // 8h window - 1h tracked
  });

  it('merges overlapping entries so trackedSeconds is not double-counted', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      // 09:00–13:00 and 11:00–15:00 overlap 11:00–13:00; merged span is 09:00–15:00 = 6h.
      entries: [entry('a', 9, 13), entry('b', 11, 15)],
    });
    expect(vm.stats.trackedSeconds).toBe(6 * 3600); // merged, not the naive 4h+4h=8h
    // The merged span is 6h, and the window is padded to the 8h minimum (09:00–17:00), so 2h
    // of the drawn window carries no entry. This is a past day, so all 8h have elapsed.
    expect(vm.stats.untrackedSeconds).toBe(2 * 3600);
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
      entries: [entry('a', 9, 13)], // 4h of the 8h min window (09–17)
      samples: [
        sample(9, 0, 'PRODUCTIVE', 80),
        sample(9, 30, 'PRODUCTIVE', 60),
        sample(10, 0, 'UNPRODUCTIVE', 10),
      ],
    });
    // productive 09:00–10:00, then unproductive 10:00–13:00 → two segments.
    expect(vm.ribbon.tracked).toHaveLength(2);
    expect(vm.ribbon.tracked[0]).toMatchObject({ category: 'PRODUCTIVE', startPct: 0 });
    expect(Math.round(vm.ribbon.tracked[0]!.widthPct)).toBe(13); // 1h of 8h
    expect(vm.ribbon.tracked[1]!.category).toBe('UNPRODUCTIVE');
    expect(Math.round(vm.ribbon.tracked[1]!.startPct)).toBe(13);
    expect(Math.round(vm.ribbon.tracked[1]!.widthPct)).toBe(38); // 3h of 8h
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
    expect(Math.round(vm.ribbon.tracked[0]!.widthPct)).toBe(50); // the 4h entry fills half of 8h
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
    // The window is padded to 8h: 09:00-17:00Z === 15:00-23:00 Dhaka.
    expect(vm.ribbon.hourTicks.map((t) => t.label)).toEqual([
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
    ]);
    expect(vm.activityBuckets[0]).toMatchObject({
      label: '15',
      activityPct: 50,
      category: 'NEUTRAL',
    });
    expect(vm.activityBuckets[1]!.category).toBe('UNTRACKED'); // 10:00 hour has no samples
  });

  it('labels hour ticks in Dhaka time, not UTC, across the 18:00Z boundary', () => {
    // 17:00-21:00Z spans 18:00Z === 00:00 Dhaka: the discriminating tick reads "18" pre-fix,
    // "00" post-fix.
    const vm = personDayView({
      ...base,
      now: new Date(iso(23)),
      entries: [entry('a', 17, 21)],
    });
    // Padding to 8h cannot run past the end of the Dhaka day, so the window is pulled BACK to
    // 10:00-18:00Z. The discriminating tick is the last one: 18:00Z reads "00", not "18".
    expect(vm.ribbon.hourTicks.map((t) => t.label)).toEqual([
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
      '00',
    ]);
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
    expect(Math.round(vm.ribbon.captures[0]!.atPct)).toBe(25); // 11:00 is 2h into the 8h window
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
  // 20:00 UTC on the 13th is already 02:00 Dhaka on the 14th.
  const now = new Date('2026-07-13T20:00:00.000Z');

  it('keeps a valid date', () => {
    expect(resolveDayDate('2026-07-01', now)).toBe('2026-07-01');
  });

  it('falls back to today when raw is undefined', () => {
    expect(resolveDayDate(undefined, now)).toBe('2026-07-14');
  });

  it.each(['2026-7-1', 'garbage'])('falls back to today on bad format %s', (raw) => {
    expect(resolveDayDate(raw, now)).toBe('2026-07-14');
  });

  it.each(['2026-13-45', '2026-02-30'])('falls back to today on impossible date %s', (raw) => {
    expect(resolveDayDate(raw, now)).toBe('2026-07-14');
  });
});

describe('resolveDayDate (Dhaka)', () => {
  it('defaults to the Dhaka day, not the UTC day', () => {
    // 18:30Z is already tomorrow in Dhaka.
    expect(resolveDayDate(undefined, new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('accepts an explicit valid day', () => {
    expect(resolveDayDate('2026-08-20', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('falls back to today when the param is not a real day', () => {
    expect(resolveDayDate('2026-02-30', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
    expect(resolveDayDate('garbage', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
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

  // RULING D (fix round 2): liveness is PER-ENTRY, not a single day-level comparison. A
  // stale sample from earlier in the day must not freeze/hide an entry that started AFTER
  // that sample's horizon -- there is no staleness evidence for THIS entry (capture died or
  // the ack was withdrawn, then the user started a fresh entry), so it falls back to `nowMs`
  // and counts as live, same as the zero-samples case.
  it('counts an entry that starts after the last sample stopped covering it', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(10, 30)),
      // starts at 10:00 -- AFTER the 09:00 sample's 09:05 horizon, so that sample is not
      // evidence about this entry at all.
      entries: [entry('a', 10, null)],
      samples: [sample(9, 0, 'NEUTRAL', 50)],
    });
    expect(vm.recordingNow).toBe(true);
    expect(vm.entries[0]?.running).toBe(true);
    expect(vm.entries[0]?.durationSeconds).toBe(1800); // 10:00 -> 10:30, unclamped
  });
});

describe('weekStrip', () => {
  it('builds seven consecutive Monday-start days with correct weekday letters and day-of-month', () => {
    const rows = weekStrip('2026-07-15', [], '2026-07-20');
    expect(rows.map((r) => r.date)).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
    expect(rows.map((r) => r.dow)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(rows.map((r) => r.num)).toEqual([13, 14, 15, 16, 17, 18, 19]);
  });

  // NOT a second discriminator for the naive-instant-stepping bug the basic test above
  // targets -- that bug fails at `dow` index 0 regardless of which week, so this case doesn't
  // add coverage for it. Its independent value is pinning the `num` field's 31 -> 1 -> 2
  // month rollover against the correct label-arithmetic implementation.
  it('carries a month boundary correctly (day-of-month resets, weekday keeps advancing)', () => {
    const rows = weekStrip('2026-07-30', [], '2026-08-02');
    expect(rows.map((r) => r.date)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(rows.map((r) => r.dow)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(rows.map((r) => r.num)).toEqual([27, 28, 29, 30, 31, 1, 2]);
  });

  it('marks the selected day and flags days after today as future', () => {
    const rows = weekStrip('2026-07-15', [], '2026-07-16');
    expect(rows.find((r) => r.date === '2026-07-15')!.selected).toBe(true);
    expect(rows.find((r) => r.date === '2026-07-16')!.future).toBe(false); // == today
    expect(rows.find((r) => r.date === '2026-07-17')!.future).toBe(true);
  });

  it('fills hours from the trends series and zero-fills a day the series omits', () => {
    const rows = weekStrip(
      '2026-07-15',
      [{ day: '2026-07-14', trackedSeconds: 7200 }],
      '2026-07-20',
    );
    expect(rows.find((r) => r.date === '2026-07-14')!.hours).toBe(2);
    expect(rows.find((r) => r.date === '2026-07-13')!.hours).toBe(0);
  });

  it("scales fillPct against the week's busiest day", () => {
    const rows = weekStrip(
      '2026-07-15',
      [
        { day: '2026-07-13', trackedSeconds: 3600 },
        { day: '2026-07-14', trackedSeconds: 7200 },
      ],
      '2026-07-20',
    );
    expect(rows.find((r) => r.date === '2026-07-14')!.fillPct).toBe(100);
    expect(rows.find((r) => r.date === '2026-07-13')!.fillPct).toBe(50);
  });
});

describe('dayRangeFor', () => {
  it('spans a single Dhaka day, inclusive of both ends', () => {
    const { from, to } = dayRangeFor('2026-08-20');
    // Dhaka midnight on 2026-08-20 is 2026-08-19T18:00:00.000Z (UTC+6, no DST).
    expect(from).toBe('2026-08-19T18:00:00.000Z');
    expect(to).toBe('2026-08-20T17:59:59.999Z');
  });

  it('does not overlap the following day (1ms before its start)', () => {
    const day1 = dayRangeFor('2026-08-20');
    const day2 = dayRangeFor('2026-08-21');
    expect(new Date(day1.to).getTime()).toBe(new Date(day2.from).getTime() - 1);
  });
});
