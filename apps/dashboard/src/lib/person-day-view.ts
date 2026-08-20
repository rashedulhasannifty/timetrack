import type { TimeEntry, ActivitySample, Screenshot, Project } from '@timetrack/contracts';

export type DayCategory = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';

export interface PersonDayInput {
  date: string; // 'YYYY-MM-DD' (UTC day being viewed)
  now: Date; // for isToday, recordingNow, open-entry duration
  isSelf: boolean;
  subjectName: string; // 'You' (self) or the person's name
  entries: TimeEntry[];
  samples: ActivitySample[];
  screenshots: Screenshot[];
  /**
   * Team projects (with their tasks) used to name entries. Auto/manual entries carry a
   * `projectId`/`taskId` but no free-text `note`, so without this an entry would render
   * "Untitled entry" despite having a project selected. Optional: an unresolved id (archived,
   * cross-team, or an empty list) simply falls back to "Untitled entry".
   */
  projects?: Project[];
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
  stats: {
    trackedSeconds: number;
    untrackedSeconds: number;
    activePct: number | null;
    /** Productive share of *categorized* samples. Null when the day has no samples at all. */
    productivePct: number | null;
  };
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

/**
 * How long after a client's last activity sample we still consider it live. Mirrors the API's
 * TRACKING_FRESHNESS_SECONDS default (packages/config/src/index.ts:76) and the server-side
 * clamp in reports.repository.ts, so the pill and the duration agree with the reports.
 */
const TRACKING_FRESHNESS_MS = 300_000;

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

/**
 * Human label for an entry. A user-authored `note` wins (most specific, preserves existing
 * behavior); otherwise name it by its project, appending the task when present ("Project · Task");
 * an entry with neither a note nor a resolvable project stays "Untitled entry".
 */
function entryLabel(
  entry: TimeEntry,
  projectNames: Map<string, string>,
  taskNames: Map<string, string>,
): string {
  if (entry.note) return entry.note;
  const parts: string[] = [];
  const projectName = entry.projectId ? projectNames.get(entry.projectId) : undefined;
  if (projectName) parts.push(projectName);
  const taskName = entry.taskId ? taskNames.get(entry.taskId) : undefined;
  if (taskName) parts.push(taskName);
  return parts.length > 0 ? parts.join(' · ') : 'Untitled entry';
}

export function personDayView(input: PersonDayInput): PersonDayViewModel {
  const { date, now, isSelf, subjectName, entries, samples } = input;

  const projects = input.projects ?? [];
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const taskNames = new Map(
    projects.flatMap((p) => (p.tasks ?? []).map((t) => [t.id, t.name] as const)),
  );

  const isToday = date === now.toISOString().slice(0, 10);
  const dayStartMs = Date.parse(`${date}T00:00:00.000Z`);
  const dayEndMs = Date.parse(`${date}T23:59:59.999Z`);
  const nowMs = now.getTime();

  // The client's last provable sign of life today. An open entry cannot accrue past this —
  // otherwise a shut-down Mac's entry grows forever and the pill never goes out (spec §4.3).
  //
  // Absence of samples is absence of evidence, not evidence of death: a user who hasn't
  // satisfied `monitoringAckAt` produces NO activity samples at all (capture is gated off
  // entirely), yet can still track time manually. There is no staleness signal to clamp
  // against for them, so the horizon stays unbounded (+Infinity) rather than collapsing to
  // -Infinity — an open entry with zero samples grows to `now()` exactly as it did before
  // this liveness gate existed. The authoritative numbers of record are the server's, clamped
  // on `heartbeatAt` regardless of ack (manual tracking never routes through AckGate), so this
  // client-side fallback cannot inflate what actually gets reported.
  const newestSampleMs = samples.reduce(
    (max, s) => Math.max(max, Date.parse(s.timestamp)),
    Number.NEGATIVE_INFINITY,
  );
  const liveHorizonMs = Number.isFinite(newestSampleMs)
    ? newestSampleMs + TRACKING_FRESHNESS_MS
    : Number.POSITIVE_INFINITY;
  const openEndMs = Math.min(nowMs, liveHorizonMs);
  // Whether the client is currently within its liveness window — with no samples at all,
  // liveHorizonMs is +Infinity, so this (and everything gated on it) is unconditionally true.
  const isLive = nowMs <= liveHorizonMs;

  const parsed = entries.map((e) => {
    const startMs = Date.parse(e.startTime);
    const open = e.endTime === null;
    const endMs = open ? null : Date.parse(e.endTime as string);
    // Math.max(startMs, ...) keeps the duration non-negative — e.g. if the only samples
    // predate the entry's own start, the horizon could fall before startMs.
    const effectiveEnd = endMs ?? (isToday ? Math.max(startMs, openEndMs) : startMs);
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

  // Share of the day's samples classified PRODUCTIVE. The denominator is every sample, not
  // just the productive+unproductive ones: a day spent entirely in unrated apps should read
  // as a low productive percentage, not as an undefined one.
  const productivePct =
    samples.length === 0
      ? null
      : Math.round(
          (samples.filter((s) => s.category === 'PRODUCTIVE').length * 100) / samples.length,
        );

  // An open entry alone is not proof of life — a crashed or shut-down client leaves one behind.
  // Require a recent activity sample too (or no staleness signal at all — see `isLive` above),
  // the same signal the Overview `tracking` flag uses.
  const recordingNow = isToday && parsed.some((p) => p.open) && isLive;

  const entryRows: DayEntryRow[] = parsed
    .map((p) => {
      const durationSeconds = Math.max(0, (p.effectiveEnd - p.startMs) / 1000);
      return {
        id: p.entry.id,
        startMs: p.startMs,
        endMs: p.endMs,
        label: entryLabel(p.entry, projectNames, taskNames),
        durationSeconds,
        // Gated the same way as `recordingNow` — a stale open entry's duration is frozen, so
        // its "running" label must not keep claiming otherwise.
        running: p.open && isToday && isLive,
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
        // Gated the same way as `recordingNow`/entryRows.running (see `isLive` above).
        const running = p.open && isToday && isLast && isLive;
        return {
          id: `${p.entry.id}#${i}`,
          startPct,
          widthPct,
          category: seg.category,
          label: entryLabel(p.entry, projectNames, taskNames),
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
    stats: { trackedSeconds, untrackedSeconds, activePct, productivePct },
    ribbon: { tracked: trackedBlocks, untracked: untrackedGaps, captures, hourTicks },
    activityBuckets,
    entries: entryRows,
  };
}

/* ---------------------------------------------------------------------------
   Week strip — the seven days around the one being viewed, so a day reads in the
   context of its week instead of in isolation.
   --------------------------------------------------------------------------- */

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_DAY_MS = 86_400_000;

export interface WeekStripDay {
  /** 'YYYY-MM-DD' — the link target. */
  date: string;
  /** Single-letter day of week. */
  dow: string;
  /** Day of month. */
  num: number;
  hours: number;
  /** Bar fill as a share of the week's busiest day, 0–100. */
  fillPct: number;
  selected: boolean;
  /** Days after today can't have data; they render as inert rather than as empty days. */
  future: boolean;
}

/** The Monday-start week containing `date`, as a [from, to] pair of ISO instants. */
export function weekRangeFor(date: string): { from: string; to: string } {
  const dayMs = Date.parse(`${date}T00:00:00.000Z`);
  const dow = new Date(dayMs).getUTCDay();
  // getUTCDay() is Sunday-based; shift so Monday is the first column.
  const mondayOffset = (dow + 6) % 7;
  const from = dayMs - mondayOffset * WEEK_DAY_MS;
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + 7 * WEEK_DAY_MS - 1).toISOString(),
  };
}

/**
 * Build the strip from a per-day trends series. `days` may be short or out of order — a day the
 * series doesn't mention is rendered as zero rather than dropped, so the strip is always seven
 * columns wide and the columns always line up with the weekday letters.
 */
export function weekStrip(
  selectedDate: string,
  days: ReadonlyArray<{ day: string; trackedSeconds: number }>,
  today: string,
): WeekStripDay[] {
  const { from } = weekRangeFor(selectedDate);
  const mondayMs = Date.parse(from);
  const byDay = new Map(days.map((d) => [d.day, d.trackedSeconds]));

  const raw = Array.from({ length: 7 }, (_, i) => {
    const ms = mondayMs + i * WEEK_DAY_MS;
    const date = new Date(ms).toISOString().slice(0, 10);
    const seconds = byDay.get(date) ?? 0;
    return {
      date,
      dow: DOW[new Date(ms).getUTCDay()]!,
      num: new Date(ms).getUTCDate(),
      hours: Math.round((seconds / 3600) * 10) / 10,
      fillPct: 0,
      selected: date === selectedDate,
      future: date > today,
    };
  });

  const peak = Math.max(0, ...raw.map((d) => d.hours));
  for (const d of raw) d.fillPct = peak === 0 ? 0 : (d.hours / peak) * 100;
  return raw;
}
