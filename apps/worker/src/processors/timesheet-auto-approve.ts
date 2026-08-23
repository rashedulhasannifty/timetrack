import { Prisma, type PrismaClient } from '@timetrack/db';
import { SYSTEM_ACTOR_ID, TeamSettingsSchema } from '@timetrack/contracts';

/**
 * The effective end of a time entry — see the canonical `ENTRY_END` at
 * `apps/api/src/modules/reports/reports.repository.ts`, duplicated here because
 * `apps/worker` may not import from `apps/api` (CLAUDE.md §3). Change one, change the other.
 */
const ENTRY_END = (freshnessSeconds: number): Prisma.Sql => Prisma.sql`
  COALESCE(
    te."endTime",
    LEAST(
      now(),
      COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => ${freshnessSeconds})
    )
  )`;

/** Why a candidate was left PENDING. Logged, so an admin can see what the job declined. */
export type SkipReason = 'unresolved-idle' | 'below-floor' | 'above-ceiling';

export interface AutoApproveOutcome {
  approved: number;
  skipped: Record<SkipReason, number>;
}

interface Candidate {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  settings: unknown;
  trackedSeconds: number;
  unresolvedIdle: number;
}

/**
 * Approve PENDING timesheets that a manager has left untouched past the team's grace period.
 *
 * The row is still CREATED pending by `timesheet-generate` on the Monday cron — this only
 * decides the ones nobody got to, `autoApproveAfterDays` after the period CLOSED. Grace is
 * measured from `periodEnd`, not from row creation, so a late backfill cannot hand a manager
 * a week that is auto-approved the moment it appears.
 *
 * Three guardrails leave a week for a human instead. Each is a case where the number is
 * probably not what it looks like, and rubber-stamping it is the one thing auto-approval must
 * never do:
 *   - the week contains an UNRESOLVED idle window (the employee never said whether that time
 *     counts, so nobody knows what the total means yet);
 *   - hours are BELOW `timesheetReminderHours`, the same floor the employee is nudged about;
 *   - hours are ABOVE `autoApproveMaxHours` — a stranded timer or a mis-set clock.
 *
 * A decision made here is not final: `ApprovalsService.decide` re-decides any row whatever its
 * status, and writes its own audit entry, so a manager can still flag an auto-approved week.
 */
export async function autoApprovePendingTimesheets(
  prisma: PrismaClient,
  now: Date,
  freshnessSeconds: number,
): Promise<AutoApproveOutcome> {
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT ta.id            AS "id",
           ta."userId"      AS "userId",
           ta."periodStart" AS "periodStart",
           ta."periodEnd"   AS "periodEnd",
           t.settings       AS "settings",
           -- Same merged, freshness-clamped total the approvals screen shows, so the job can
           -- never approve a number a manager would not have seen.
           COALESCE((
             SELECT COALESCE((
               SELECT SUM(EXTRACT(EPOCH FROM (upper(x) - lower(x))))
               FROM unnest(q.mr) AS x
             ), 0)
             FROM (
               SELECT range_agg(tstzrange(
                        date_trunc('second', GREATEST(te."startTime", ta."periodStart")),
                        GREATEST(
                          date_trunc('second', LEAST(${ENTRY_END(freshnessSeconds)}, ta."periodEnd")),
                          date_trunc('second', GREATEST(te."startTime", ta."periodStart"))
                        )
                      )) AS mr
               FROM time_entries te
               WHERE te."userId" = ta."userId"
                 AND te."startTime" < ta."periodEnd"
                 AND ${ENTRY_END(freshnessSeconds)} > ta."periodStart"
                 AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
             ) q
           ), 0)::int AS "trackedSeconds",
           (
             SELECT COUNT(*)::int
             FROM idle_events ie
             WHERE ie."userId" = ta."userId"
               AND ie."resolvedAction" = 'UNRESOLVED'
               AND ie."startTime" < ta."periodEnd"
               AND ie."endTime"   > ta."periodStart"
           ) AS "unresolvedIdle"
    FROM timesheet_approvals ta
    JOIN users u ON u.id = ta."userId" AND u."deactivatedAt" IS NULL
    JOIN teams t ON t.id = u."teamId"
    WHERE ta.status = 'PENDING'
      AND (t.settings ->> 'autoApproveTimesheets')::boolean IS TRUE
      AND ta."periodEnd" + make_interval(
            days => COALESCE((t.settings ->> 'autoApproveAfterDays')::int, 3)
          ) <= ${now}::timestamptz
  `;

  const outcome: AutoApproveOutcome = {
    approved: 0,
    skipped: { 'unresolved-idle': 0, 'below-floor': 0, 'above-ceiling': 0 },
  };

  for (const c of candidates) {
    // Parsed, not read raw: settings is a Json column, and a legacy row may be missing keys
    // the guardrails depend on. The read schema fills them with the shipped defaults.
    const settings = TeamSettingsSchema.parse(c.settings ?? {});
    const hours = c.trackedSeconds / 3600;

    const reason = skipReasonFor(c.unresolvedIdle, hours, settings);
    if (reason) {
      outcome.skipped[reason] += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Guarded on PENDING: a manager deciding between the SELECT above and this write must
      // win. `updateMany` reports how many rows matched, so a race is a no-op, not a clobber.
      const written = await tx.timesheetApproval.updateMany({
        where: { id: c.id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          totalSeconds: c.trackedSeconds,
          decidedAt: now,
          reviewerId: null, // no human decided this; the audit row carries the system actor
          note: `Auto-approved after ${settings.autoApproveAfterDays} day(s) with no decision.`,
        },
      });
      if (written.count === 0) return;
      await tx.auditLog.create({
        data: {
          actorId: SYSTEM_ACTOR_ID,
          action: 'timesheet.auto-approve',
          targetType: 'TimesheetApproval',
          targetId: c.id,
          diff: { from: 'PENDING', to: 'APPROVED', totalSeconds: c.trackedSeconds },
        },
      });
      outcome.approved += 1;
    });
  }

  return outcome;
}

/** Pure guardrail decision — unit-tested without a database. */
export function skipReasonFor(
  unresolvedIdle: number,
  hours: number,
  settings: { timesheetReminderHours: number; autoApproveMaxHours: number },
): SkipReason | null {
  if (unresolvedIdle > 0) return 'unresolved-idle';
  // 0 disables the floor, exactly as it disables the reminder email.
  if (settings.timesheetReminderHours > 0 && hours < settings.timesheetReminderHours) {
    return 'below-floor';
  }
  if (hours > settings.autoApproveMaxHours) return 'above-ceiling';
  return null;
}
