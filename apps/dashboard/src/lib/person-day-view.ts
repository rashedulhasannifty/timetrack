import type { TimeEntry, ActivitySample, Screenshot } from '@timetrack/contracts';

export type DayCategory = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';

export interface PersonDayInput {
  date: string; // 'YYYY-MM-DD' (UTC day being viewed)
  now: Date; // for isToday, recordingNow, open-entry duration
  isSelf: boolean;
  subjectName: string; // 'You' (self) or the person's name
  entries: TimeEntry[];
  samples: ActivitySample[];
  screenshots: Screenshot[];
}

export interface RibbonBlock {
  id: string;
  startPct: number;
  widthPct: number;
  category: DayCategory;
  label: string;
  startMs: number;
  endMs: number | null;
  running: boolean;
}
export interface RibbonGap {
  startPct: number;
  widthPct: number;
}
export interface CaptureMark {
  atPct: number;
  screenshotId: string;
}
export interface HourTick {
  atPct: number;
  label: string;
}
export interface ActivityBucket {
  label: string;
  activityPct: number | null;
  category: DayCategory | 'UNTRACKED';
}
export interface DayEntryRow {
  id: string;
  startMs: number;
  endMs: number | null;
  label: string;
  durationSeconds: number;
  running: boolean;
}

export interface PersonDayViewModel {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
  window: { startMs: number; endMs: number };
  stats: { trackedSeconds: number; untrackedSeconds: number; activePct: number | null };
  ribbon: {
    tracked: RibbonBlock[];
    untracked: RibbonGap[];
    captures: CaptureMark[];
    hourTicks: HourTick[];
  };
  activityBuckets: ActivityBucket[];
  entries: DayEntryRow[];
}

const HOUR_MS = 3_600_000;
const MIN_WINDOW_MS = 4 * HOUR_MS;

/** Floor an epoch-ms timestamp down to the start of its UTC hour. */
function floorToHourUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
}

/** Ceil an epoch-ms timestamp up to the start of the next UTC hour (no-op if already on the hour). */
function ceilToHourUTC(ms: number): number {
  const floored = floorToHourUTC(ms);
  return floored === ms ? floored : floored + HOUR_MS;
}

export function personDayView(input: PersonDayInput): PersonDayViewModel {
  const { date, now, isSelf, subjectName, entries, samples } = input;

  const isToday = date === now.toISOString().slice(0, 10);
  const dayStartMs = Date.parse(`${date}T00:00:00.000Z`);
  const dayEndMs = Date.parse(`${date}T23:59:59.999Z`);
  const nowMs = now.getTime();

  const parsed = entries.map((e) => {
    const startMs = Date.parse(e.startTime);
    const open = e.endTime === null;
    const endMs = open ? null : Date.parse(e.endTime as string);
    const effectiveEnd = endMs ?? (isToday ? nowMs : startMs);
    return { entry: e, startMs, endMs, open, effectiveEnd };
  });

  // Window: collect every timestamp of interest.
  const timestamps: number[] = [];
  for (const p of parsed) {
    timestamps.push(p.startMs);
    timestamps.push(p.effectiveEnd);
  }
  for (const s of samples) {
    timestamps.push(Date.parse(s.timestamp));
  }
  for (const shot of input.screenshots) {
    timestamps.push(Date.parse(shot.timestamp));
  }

  let windowStartMs: number;
  let windowEndMs: number;
  if (timestamps.length === 0) {
    windowStartMs = Date.parse(`${date}T09:00:00.000Z`);
    windowEndMs = Date.parse(`${date}T18:00:00.000Z`);
  } else {
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    windowStartMs = floorToHourUTC(min);
    windowEndMs = ceilToHourUTC(max);
    if (windowEndMs - windowStartMs < MIN_WINDOW_MS) {
      windowEndMs = Math.min(windowStartMs + MIN_WINDOW_MS, dayEndMs);
      if (windowEndMs - windowStartMs < MIN_WINDOW_MS) {
        windowStartMs = Math.max(windowEndMs - MIN_WINDOW_MS, dayStartMs);
      }
    }
  }

  // Stats
  let trackedSeconds = 0;
  for (const p of parsed) {
    const durationSeconds = (p.effectiveEnd - p.startMs) / 1000;
    if (durationSeconds > 0) trackedSeconds += durationSeconds;
  }

  const untrackedSeconds = Math.max(
    0,
    Math.round((windowEndMs - windowStartMs) / 1000) - trackedSeconds,
  );

  const activePct =
    samples.length === 0
      ? null
      : Math.round(samples.reduce((sum, s) => sum + s.activityPct, 0) / samples.length);

  const recordingNow = isToday && parsed.some((p) => p.open);

  const entryRows: DayEntryRow[] = parsed
    .map((p) => {
      const durationSeconds = Math.max(0, (p.effectiveEnd - p.startMs) / 1000);
      return {
        id: p.entry.id,
        startMs: p.startMs,
        endMs: p.endMs,
        label: p.entry.note ?? 'Untitled entry',
        durationSeconds,
        running: p.open && isToday,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);

  return {
    date,
    subjectName,
    isSelf,
    isToday,
    recordingNow,
    window: { startMs: windowStartMs, endMs: windowEndMs },
    stats: { trackedSeconds, untrackedSeconds, activePct },
    ribbon: { tracked: [], untracked: [], captures: [], hourTicks: [] },
    activityBuckets: [],
    entries: entryRows,
  };
}
