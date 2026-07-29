import { describe, it, expect } from 'vitest';
import { personDayView } from './person-day-view';
import type { TimeEntry } from '@timetrack/contracts';

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
});
