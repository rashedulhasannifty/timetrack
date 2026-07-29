import { describe, it, expect } from 'vitest';
import { personDayView, resolveDayDate } from './person-day-view';
import type { TimeEntry, ActivitySample, Screenshot } from '@timetrack/contracts';

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
    const vm = personDayView({ ...base, date: '2026-07-13', now, entries: [entry('a', 14, null)] });
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
  it('positions a tracked block as a % of the window and colors by dominant category', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)], // fills the 4h min window exactly
      samples: [
        sample(9, 0, 'PRODUCTIVE', 80),
        sample(9, 30, 'PRODUCTIVE', 60),
        sample(10, 0, 'UNPRODUCTIVE', 10),
      ],
    });
    const b = vm.ribbon.tracked[0]!;
    expect(b.startPct).toBe(0);
    expect(Math.round(b.widthPct)).toBe(100);
    expect(b.category).toBe('PRODUCTIVE'); // 2 productive vs 1 unproductive
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
