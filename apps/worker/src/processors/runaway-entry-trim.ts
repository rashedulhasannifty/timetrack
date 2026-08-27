import { randomFillSync } from 'node:crypto';
import { Prisma, type PrismaClient } from '@timetrack/db';
import { TeamSettingsSchema } from '@timetrack/contracts';

/**
 * One-off repair for time entries that ran unattended.
 *
 * Manual tracking used to run straight through an away window and keep it (fixed client-side in
 * the manual inactivity timeout). A Mac left awake produced one unbroken span — 47 hours in the
 * case that prompted this — and the day it started reported more tracked hours than a day has.
 * The client fix bounds new spans; it cannot reach rows already written.
 *
 * This RECONSTRUCTS what the fixed client would have recorded, rather than truncating. A runaway
 * span usually contains real work on both sides of the unattended stretch: cutting at the first
 * idle gap would delete the far side outright, and these rows are someone's pay. So the span is
 * SPLIT into the stretches that have evidence behind them, and only the unattended time between
 * them is dropped.
 *
 * Evidence is `activity_samples`. The client samples once a minute WHILE TRACKING, so inside an
 * open span an idle stretch shows up in one of two shapes, and both count:
 *
 *   - the Mac was awake but untouched → a run of samples with `activityPct == 0`;
 *   - the Mac was asleep or locked → no rows at all, because no timer fired.
 *
 * Reading only `activityPct` would miss the second shape entirely — which is the shape a machine
 * left overnight actually leaves behind. Both are handled by walking the gaps BETWEEN samples that
 * show activity, so an absence of rows is as much a gap as a row saying zero.
 */

/** A stretch of work the sample timeline supports, reconstructed from one runaway span. */
export interface Stretch {
  start: Date;
  end: Date;
}

/**
 * Split `span` into the stretches a fixed client would have recorded.
 *
 * `activeAt` is every sample timestamp inside the span whose `activityPct > 0`, ascending. The
 * span's own start counts as evidence too — starting the timer is a deliberate act — so a person
 * who started and immediately walked away still gets the threshold credited, exactly as the live
 * client now credits it.
 *
 * Each stretch ends `thresholdSeconds` after its last evidence, never past the span's real end:
 * that is the same "keep the idle minutes up to the timeout" rule the client applies, so a repaired
 * row and a freshly recorded one describe the same day the same way.
 *
 * Pure — no clock, no database — so the rule can be tested exhaustively on its own.
 */
export function reconstructStretches(
  span: { start: Date; end: Date },
  activeAt: readonly Date[],
  thresholdSeconds: number,
): Stretch[] {
  const thresholdMs = thresholdSeconds * 1000;
  const capMs = span.end.getTime();
  const anchors = [span.start.getTime(), ...activeAt.map((d) => d.getTime())]
    .filter((t) => t >= span.start.getTime() && t <= capMs)
    .sort((a, b) => a - b);

  const out: Stretch[] = [];
  let stretchStart = anchors[0] ?? span.start.getTime();
  let prev = stretchStart;

  for (const t of anchors.slice(1)) {
    if (t - prev >= thresholdMs) {
      out.push({
        start: new Date(stretchStart),
        end: new Date(Math.min(prev + thresholdMs, capMs)),
      });
      stretchStart = t;
    }
    prev = t;
  }

  // The tail. If nothing happened for a threshold's worth before the span's recorded end, the
  // person had already gone — close where the timeout would have, not where the clock kept running.
  const tailIdle = capMs - prev;
  out.push({
    start: new Date(stretchStart),
    end: new Date(tailIdle >= thresholdMs ? Math.min(prev + thresholdMs, capMs) : capMs),
  });

  return out.filter((s) => s.end.getTime() > s.start.getTime());
}

/** Why an entry was left alone. Reported, never silently skipped. */
export type SkipReason = 'no-capture-evidence' | 'already-bounded';

export interface EntryOutcome {
  entryId: string;
  userId: string;
  userName: string;
  startTime: Date;
  endTime: Date;
  originalSeconds: number;
  thresholdMinutes: number;
  sampleCount: number;
  skipped: SkipReason | null;
  /** The reconstruction. Empty when skipped. */
  stretches: Stretch[];
  /** Seconds the repair removes — all of it unattended by construction. */
  removedSeconds: number;
  /** Ids minted for stretches 2..N. Empty on a dry run. */
  addedEntryIds: string[];
}

export interface TrimReport {
  candidates: number;
  repaired: number;
  skipped: number;
  removedSeconds: number;
  applied: boolean;
  outcomes: EntryOutcome[];
}

/**
 * UUIDv7, minted here rather than pulled in as a dependency.
 *
 * `time_entries.id` is normally the client's idempotency key and has no database default, so the
 * rows this creates need one. v7 (not v4) because the id is time-ordered everywhere else in the
 * table and the export pagination sorts on `(startTime, id)`.
 */
function uuidV7(at: Date): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  const ms = BigInt(at.getTime());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** No human ordered this row-by-row, so the audit trail names the repair rather than a person. */
const ACTOR = 'system:trim-runaway-entries';

export async function trimRunawayEntries(
  prisma: PrismaClient,
  opts: { minHours: number; apply: boolean; now: Date },
): Promise<TrimReport> {
  const minSeconds = opts.minHours * 3600;

  // Narrowed in SQL, not in JS. Duration is a column-to-column comparison Prisma cannot express,
  // and the naive version — pull every closed entry and filter here — walks the whole table on a
  // production database to find a handful of rows.
  //
  // Closed entries only. An OPEN one is either genuinely running or already handled by the
  // stale-running retirement on the next client write — not this script's business.
  const candidateIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM time_entries
    WHERE "endTime" IS NOT NULL
      AND "endTime" - "startTime" > make_interval(secs => ${minSeconds})
  `;
  if (candidateIds.length === 0) {
    return {
      candidates: 0,
      repaired: 0,
      skipped: 0,
      removedSeconds: 0,
      applied: opts.apply,
      outcomes: [],
    };
  }

  const candidates = await prisma.timeEntry.findMany({
    where: { id: { in: candidateIds.map((r) => r.id) } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      taskId: true,
      source: true,
      note: true,
      startTime: true,
      endTime: true,
      user: { select: { name: true, team: { select: { settings: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });

  const outcomes: EntryOutcome[] = [];

  for (const entry of candidates) {
    const endTime = entry.endTime as Date;
    const originalSeconds = (endTime.getTime() - entry.startTime.getTime()) / 1000;
    if (originalSeconds <= minSeconds) continue; // already excluded in SQL; kept as a guard

    const settings = TeamSettingsSchema.parse(entry.user.team.settings ?? {});
    const thresholdSeconds = settings.idleThresholdMinutes * 60;

    const samples = await prisma.activitySample.findMany({
      where: { userId: entry.userId, timestamp: { gte: entry.startTime, lte: endTime } },
      select: { timestamp: true, activityPct: true },
      orderBy: { timestamp: 'asc' },
    });

    const base = {
      entryId: entry.id,
      userId: entry.userId,
      userName: entry.user.name,
      startTime: entry.startTime,
      endTime,
      originalSeconds,
      thresholdMinutes: settings.idleThresholdMinutes,
      sampleCount: samples.length,
    };

    // No samples ANYWHERE in the span means capture was not running — a team with activity
    // capture off, or a span older than the samples retention window. There is no evidence of
    // when this person stopped working, and inventing one would rewrite their hours on a guess.
    if (samples.length === 0) {
      outcomes.push({
        ...base,
        skipped: 'no-capture-evidence',
        stretches: [],
        removedSeconds: 0,
        addedEntryIds: [],
      });
      continue;
    }

    const activeAt = samples.filter((s) => s.activityPct > 0).map((s) => s.timestamp);
    const stretches = reconstructStretches(
      { start: entry.startTime, end: endTime },
      activeAt,
      thresholdSeconds,
    );
    const keptSeconds = stretches.reduce(
      (sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 1000,
      0,
    );
    const removedSeconds = originalSeconds - keptSeconds;

    if (removedSeconds <= 0) {
      outcomes.push({
        ...base,
        skipped: 'already-bounded',
        stretches,
        removedSeconds: 0,
        addedEntryIds: [],
      });
      continue;
    }

    const addedEntryIds: string[] = [];
    if (opts.apply) {
      const first = stretches[0]!;
      const rest = stretches.slice(1);
      const added = rest.map((s) => ({
        id: uuidV7(s.start),
        userId: entry.userId,
        projectId: entry.projectId,
        taskId: entry.taskId,
        source: entry.source,
        note: entry.note,
        startTime: s.start,
        endTime: s.end,
        editedAt: opts.now,
      }));
      addedEntryIds.push(...added.map((a) => a.id));

      // One transaction PER ENTRY, not one around the batch: the default interactive-transaction
      // timeout is 5s, and a batch of these would blow it while passing on a small test set.
      // Per-entry also means a failure leaves every other repair intact.
      await prisma.$transaction(async (tx) => {
        await tx.timeEntry.update({
          where: { id: entry.id },
          // `editedById` stays null on purpose — no user made this decision, and the column is a
          // user reference everywhere else. The audit row below is what names the actor.
          data: { endTime: first.end, editedAt: opts.now },
        });
        if (added.length > 0) await tx.timeEntry.createMany({ data: added });
        await tx.auditLog.create({
          data: {
            actorId: ACTOR,
            action: 'time_entry.trim_runaway',
            targetType: 'time_entry',
            targetId: entry.id,
            // The whole before-state is snapshotted: after this commits, the original span's
            // shape exists nowhere else.
            diff: {
              before: { startTime: entry.startTime.toISOString(), endTime: endTime.toISOString() },
              after: stretches.map((s) => ({
                startTime: s.start.toISOString(),
                endTime: s.end.toISOString(),
              })),
              addedEntryIds,
              removedSeconds,
              idleThresholdMinutes: settings.idleThresholdMinutes,
              sampleCount: samples.length,
            } satisfies Prisma.InputJsonValue,
          },
        });
      });
    }

    outcomes.push({ ...base, skipped: null, stretches, removedSeconds, addedEntryIds });
  }

  return {
    candidates: outcomes.length,
    repaired: outcomes.filter((o) => o.skipped === null).length,
    skipped: outcomes.filter((o) => o.skipped !== null).length,
    removedSeconds: outcomes.reduce((sum, o) => sum + o.removedSeconds, 0),
    applied: opts.apply,
    outcomes,
  };
}
