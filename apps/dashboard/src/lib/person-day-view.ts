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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a `?date=` query param to a safe 'YYYY-MM-DD'. `raw` is kept only if it matches the
 * date-only format AND round-trips through `Date` (rejects both unparseable strings and
 * JS's silent day/month overflow normalization, e.g. '2026-13-45' -> '2027-01-14'). Otherwise
 * falls back to `now`'s UTC date.
 */
export function resolveDayDate(raw: string | undefined, now: Date): string {
  if (raw && DATE_RE.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) {
      return raw;
    }
  }
  return now.toISOString().slice(0, 10);
}

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

/** Sort by start and coalesce overlapping/touching [start, end] intervals into a minimal covering set. */
function mergeIntervals(
  intervals: { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

/** Dominant category among samples: most samples wins; tie-break UNPRODUCTIVE > NEUTRAL > PRODUCTIVE; none -> NEUTRAL. */
function dominantCategory(categorySamples: ActivitySample[]): DayCategory {
  if (categorySamples.length === 0) return 'NEUTRAL';
  const counts: Record<DayCategory, number> = { PRODUCTIVE: 0, NEUTRAL: 0, UNPRODUCTIVE: 0 };
  for (const s of categorySamples) {
    const cat = s.category;
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const tieOrder: DayCategory[] = ['UNPRODUCTIVE', 'NEUTRAL', 'PRODUCTIVE'];
  let best: DayCategory = tieOrder[0] as DayCategory;
  for (const cat of tieOrder) {
    if (counts[cat] > counts[best]) best = cat;
  }
  return best;
}

/**
 * Split a tracked entry's span into contiguous same-category segments, driven by its activity
 * samples: each sample's category owns the interval from its time until the next sample (the first
 * sample extends back to the entry start, the last forward to the entry end). An entry with no
 * samples is a single NEUTRAL segment. Segments tile `[startMs, endMs)` with no gaps, so a brief
 * unproductive stretch inside an otherwise-neutral entry surfaces as its own colored slice instead
 * of being hidden by a single dominant color.
 */
function categorySegments(
  startMs: number,
  endMs: number,
  entrySamples: { t: number; category: DayCategory }[],
): { startMs: number; endMs: number; category: DayCategory }[] {
  if (endMs <= startMs) return [];
  const sorted = [...entrySamples].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [{ startMs, endMs, category: 'NEUTRAL' }];

  const raw: { startMs: number; endMs: number; category: DayCategory }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = i === 0 ? startMs : (sorted[i] as { t: number }).t;
    const to = i === sorted.length - 1 ? endMs : (sorted[i + 1] as { t: number }).t;
    if (to > from)
      raw.push({
        startMs: from,
        endMs: to,
        category: (sorted[i] as { category: DayCategory }).category,
      });
  }

  const merged: { startMs: number; endMs: number; category: DayCategory }[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.category === seg.category && seg.startMs <= last.endMs) {
      last.endMs = seg.endMs;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
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

  // pct(ms) = clamp(((ms - window.startMs) / (window.endMs - window.startMs)) * 100, 0, 100)
  const windowSpanMs = windowEndMs - windowStartMs;
  const pct = (ms: number): number => {
    const raw = ((ms - windowStartMs) / windowSpanMs) * 100;
    return Math.min(100, Math.max(0, raw));
  };

  // Stats — trackedSeconds is the sum of MERGED tracked intervals so overlapping entries
  // aren't double-counted against the window they're drawn in.
  const mergedTrackedMs = mergeIntervals(
    parsed
      .map((p) => ({ start: p.startMs, end: p.effectiveEnd }))
      .filter((iv) => iv.end > iv.start),
  );
  const trackedSeconds = mergedTrackedMs.reduce((sum, iv) => sum + (iv.end - iv.start) / 1000, 0);

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

  // Tracked blocks — each entry is tiled into contiguous same-category segments (from its samples)
  // so intra-entry category variation shows, instead of one dominant color per entry.
  const trackedBlocks: RibbonBlock[] = parsed
    .flatMap((p) => {
      const entrySamples = samples
        .filter((s) => {
          const t = Date.parse(s.timestamp);
          return t >= p.startMs && t < p.effectiveEnd;
        })
        .map((s) => ({ t: Date.parse(s.timestamp), category: s.category }));
      const segments = categorySegments(p.startMs, p.effectiveEnd, entrySamples);
      return segments.map((seg, i) => {
        const startPct = pct(seg.startMs);
        const widthPct = Math.max(0, pct(seg.endMs) - startPct);
        const isLast = i === segments.length - 1;
        const running = p.open && isToday && isLast;
        return {
          id: `${p.entry.id}#${i}`,
          startPct,
          widthPct,
          category: seg.category,
          label: p.entry.note ?? 'Untitled entry',
          startMs: seg.startMs,
          endMs: running ? null : seg.endMs,
          running,
        };
      });
    })
    .sort((a, b) => a.startPct - b.startPct);

  // Untracked gaps: walk merged [startPct, endPct] intervals across [0, 100].
  const GAP_THRESHOLD_PCT = 0.5;
  const mergedPctIntervals = mergeIntervals(
    trackedBlocks.map((b) => ({ start: b.startPct, end: b.startPct + b.widthPct })),
  );
  const untrackedGaps: RibbonGap[] = [];
  let cursor = 0;
  for (const iv of mergedPctIntervals) {
    if (iv.start > cursor) {
      const widthPct = iv.start - cursor;
      if (widthPct >= GAP_THRESHOLD_PCT) {
        untrackedGaps.push({ startPct: cursor, widthPct });
      }
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (100 - cursor >= GAP_THRESHOLD_PCT) {
    untrackedGaps.push({ startPct: cursor, widthPct: 100 - cursor });
  }

  // Capture marks
  const captures: CaptureMark[] = input.screenshots.map((shot) => ({
    atPct: pct(Date.parse(shot.timestamp)),
    screenshotId: shot.id,
  }));

  // Hour ticks: one per UTC hour boundary within [windowStartMs, windowEndMs].
  const hourTicks: HourTick[] = [];
  const activityBuckets: ActivityBucket[] = [];
  for (let hourMs = ceilToHourUTC(windowStartMs); hourMs <= windowEndMs; hourMs += HOUR_MS) {
    const label = String(new Date(hourMs).getUTCHours()).padStart(2, '0');
    hourTicks.push({ atPct: pct(hourMs), label });

    if (hourMs < windowEndMs) {
      const bucketEndMs = hourMs + HOUR_MS;
      const bucketSamples = samples.filter((s) => {
        const t = Date.parse(s.timestamp);
        return t >= hourMs && t < bucketEndMs;
      });
      const activityPct =
        bucketSamples.length === 0
          ? null
          : Math.round(
              bucketSamples.reduce((sum, s) => sum + s.activityPct, 0) / bucketSamples.length,
            );
      const category: DayCategory | 'UNTRACKED' =
        bucketSamples.length === 0 ? 'UNTRACKED' : dominantCategory(bucketSamples);
      activityBuckets.push({ label, activityPct, category });
    }
  }

  return {
    date,
    subjectName,
    isSelf,
    isToday,
    recordingNow,
    window: { startMs: windowStartMs, endMs: windowEndMs },
    stats: { trackedSeconds, untrackedSeconds, activePct },
    ribbon: { tracked: trackedBlocks, untracked: untrackedGaps, captures, hourTicks },
    activityBuckets,
    entries: entryRows,
  };
}
