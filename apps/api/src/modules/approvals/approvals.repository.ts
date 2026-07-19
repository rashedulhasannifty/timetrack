import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { ApprovalStatus, TimesheetApproval } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

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

// Whole-second clamped duration of one entry against [from,to] — slice-3.2 semantics.
const CLAMPED_SECONDS = (fromCol: Prisma.Sql, toCol: Prisma.Sql): Prisma.Sql => Prisma.sql`
  FLOOR(GREATEST(EXTRACT(EPOCH FROM (
    date_trunc('second', LEAST(COALESCE(te."endTime", now()), ${toCol}))
    - date_trunc('second', GREATEST(te."startTime", ${fromCol}))
  )), 0))::int`;

/**
 * CLAUDE.md §3 — Prisma lives HERE. `list`/`getOne` share one SELECT projection
 * (live trackedSeconds via a correlated subquery); only the WHERE predicate differs
 * between a scoped/status-filtered list and a single-row lookup by id.
 */
@Injectable()
export class ApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
               SELECT SUM(${CLAMPED_SECONDS(Prisma.sql`ta."periodStart"`, Prisma.sql`ta."periodEnd"`)})
               FROM time_entries te
               WHERE te."userId" = ta."userId"
                 AND te."startTime" < ta."periodEnd"
                 AND COALESCE(te."endTime", now()) > ta."periodStart"
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
      SELECT COALESCE(SUM(${CLAMPED_SECONDS(Prisma.sql`${from}::timestamptz`, Prisma.sql`${to}::timestamptz`)}), 0)::int AS "seconds"
      FROM time_entries te
      WHERE te."userId" = ${userId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
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
