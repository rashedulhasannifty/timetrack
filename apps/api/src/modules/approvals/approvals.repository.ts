import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { ApprovalStatus, TimesheetApproval } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { TRACKING_FRESHNESS_SECONDS } from './approvals.tokens.js';

export type ApprovalScope =
  { kind: 'user'; userId: string } | { kind: 'team'; teamId: string } | { kind: 'all' };

export type ApprovalRow = TimesheetApproval;

interface RawRow {
  id: string;
  userId: string;
  userName: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  status: ApprovalStatus;
  trackedSeconds: number | bigint;
  totalSeconds: number | bigint | null;
  reviewerId: string | null;
  note: string | null;
  decidedAt: Date | string | null;
}

/**
 * The effective end of an entry, matching `ENTRY_END` in reports.repository.ts. An OPEN entry
 * ends at whichever comes first: now, or its last heartbeat plus the freshness window.
 *
 * This used to be a bare `COALESCE(te."endTime", now())`. A stranded open row — a crash, a
 * shutdown, a Mac that never came back — then accrued all the way to the period end, so a week
 * with one such row showed a manager hours that /reports did not show, and approving it
 * snapshotted the inflated figure into `totalSeconds`. `timesheet-generate`'s IS_EVIDENCE only
 * stops a week that is ENTIRELY stranded from being created; it does nothing for a real week
 * that happens to contain one stranded row.
 */
const ENTRY_END = (freshnessSeconds: number): Prisma.Sql => Prisma.sql`
  COALESCE(
    te."endTime",
    LEAST(
      now(),
      COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => ${freshnessSeconds})
    )
  )`;

// Whole-second clamped duration of one entry against [from,to] — slice-3.2 semantics.
const CLAMPED_SECONDS = (
  fromCol: Prisma.Sql,
  toCol: Prisma.Sql,
  freshnessSeconds: number,
): Prisma.Sql => Prisma.sql`
  FLOOR(GREATEST(EXTRACT(EPOCH FROM (
    date_trunc('second', LEAST(${ENTRY_END(freshnessSeconds)}, ${toCol}))
    - date_trunc('second', GREATEST(te."startTime", ${fromCol}))
  )), 0))::int`;

/**
 * CLAUDE.md §3 — Prisma lives HERE. `list`/`getOne` share one SELECT projection
 * (live trackedSeconds via a correlated subquery); only the WHERE predicate differs
 * between a scoped/status-filtered list and a single-row lookup by id.
 */
@Injectable()
export class ApprovalsRepository {
  // PrismaService is named EXPLICITLY rather than left to the emitted type metadata: once any
  // parameter carries an @Inject, Nest resolves the whole list from metadata that vitest's
  // transform drops, and the class then fails to construct with "argument at index [0]".
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number,
  ) {}

  private scopeSql(scope: ApprovalScope): Prisma.Sql {
    switch (scope.kind) {
      case 'user':
        return Prisma.sql`ta."userId" = ${scope.userId}`;
      case 'team':
        return Prisma.sql`u."teamId" = ${scope.teamId}`;
      case 'all':
        return Prisma.sql`TRUE`;
    }
  }

  private map(r: RawRow): ApprovalRow {
    return {
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      periodStart: new Date(r.periodStart).toISOString(),
      periodEnd: new Date(r.periodEnd).toISOString(),
      status: r.status,
      trackedSeconds: Number(r.trackedSeconds),
      totalSeconds: r.totalSeconds === null ? null : Number(r.totalSeconds),
      reviewerId: r.reviewerId,
      note: r.note,
      decidedAt: r.decidedAt === null ? null : new Date(r.decidedAt).toISOString(),
    };
  }

  /** Shared projection for `list` and `getOne` — only the WHERE predicate differs. */
  private async selectRows(whereSql: Prisma.Sql): Promise<ApprovalRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT ta.id AS "id", ta."userId" AS "userId", u.name AS "userName",
             ta."periodStart" AS "periodStart", ta."periodEnd" AS "periodEnd",
             ta.status AS "status", ta."totalSeconds" AS "totalSeconds",
             ta."reviewerId" AS "reviewerId", ta.note AS "note", ta."decidedAt" AS "decidedAt",
             COALESCE((
               SELECT SUM(${CLAMPED_SECONDS(
                 Prisma.sql`ta."periodStart"`,
                 Prisma.sql`ta."periodEnd"`,
                 this.trackingFreshnessSeconds,
               )})
               FROM time_entries te
               WHERE te."userId" = ta."userId"
                 AND te."startTime" < ta."periodEnd"
                 AND ${ENTRY_END(this.trackingFreshnessSeconds)} > ta."periodStart"
             ), 0)::int AS "trackedSeconds"
      FROM timesheet_approvals ta
      JOIN users u ON u.id = ta."userId"
      WHERE ${whereSql}
      ORDER BY ta."periodStart" DESC, u.name ASC
    `;
    return rows.map((r) => this.map(r));
  }

  async list(scope: ApprovalScope, status?: ApprovalStatus): Promise<ApprovalRow[]> {
    const statusFilter = status
      ? Prisma.sql`AND ta.status::text = ${status}` // cast the COLUMN to text — no dependency on the enum type name
      : Prisma.empty;
    return this.selectRows(Prisma.sql`(${this.scopeSql(scope)}) ${statusFilter}`);
  }

  /** Same projection as `list`, scoped to a single row by id (no scope filter). */
  private async getOne(id: string): Promise<ApprovalRow> {
    const rows = await this.selectRows(Prisma.sql`ta.id = ${id}`);
    return rows[0]!;
  }

  findById(id: string) {
    return this.prisma.timesheetApproval.findUnique({
      where: { id },
      select: { id: true, userId: true, periodStart: true, periodEnd: true, status: true },
    });
  }

  async periodTrackedSeconds(userId: string, from: Date, to: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ seconds: number | bigint }>>`
      SELECT COALESCE(SUM(${CLAMPED_SECONDS(
        Prisma.sql`${from}::timestamptz`,
        Prisma.sql`${to}::timestamptz`,
        this.trackingFreshnessSeconds,
      )}), 0)::int AS "seconds"
      FROM time_entries te
      WHERE te."userId" = ${userId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(this.trackingFreshnessSeconds)} > ${from}::timestamptz
    `;
    return Number(row?.seconds ?? 0);
  }

  async decide(
    id: string,
    args: {
      status: 'APPROVED' | 'FLAGGED';
      note: string | null;
      reviewerId: string;
      totalSeconds: number;
      prevStatus: ApprovalStatus;
    },
  ): Promise<ApprovalRow> {
    await this.prisma.$transaction(async (tx) => {
      await tx.timesheetApproval.update({
        where: { id },
        data: {
          status: args.status,
          note: args.note,
          reviewerId: args.reviewerId,
          totalSeconds: args.totalSeconds,
          decidedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: args.reviewerId,
          action: 'timesheet.decide',
          targetType: 'TimesheetApproval',
          targetId: id,
          diff: { from: args.prevStatus, to: args.status, note: args.note },
        },
      });
    });
    return this.getOne(id);
  }
}
