import { Injectable } from '@nestjs/common';
import type { AuditLogPage, AuditLogQuery, Role, TeamSettings } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * Per-table row counts destroyed by an erase — the audit diff payload. Declared as a `type`, NOT
 * an interface: Prisma's InputJsonValue needs the implicit index signature (TS2322 otherwise).
 */
export type EraseCounts = {
  refreshTokens: number;
  timeEntries: number;
  timesheetApprovals: number;
  activitySamples: number;
  screenshots: number;
  idleEvents: number;
  activityDailySummaries: number;
  invites: number;
};

export type EraseResult = { status: 'OK'; counts: EraseCounts } | { status: 'LAST_ADMIN' };

/** Not a valid Argon2 encoded hash, so a verify can never succeed. auth.service rejects a
 *  deactivated user BEFORE reaching argon2.verify, so this never reaches the verifier. */
const ERASED_PASSWORD_HASH = 'erased';

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAudit(query: AuditLogQuery): Promise<AuditLogPage> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.from || query.to
          ? {
              timestamp: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      // id in the sort makes the cursor deterministic even when timestamps tie.
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1, // the extra row tells us whether a next page exists
      select: {
        id: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        diff: true,
        timestamp: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null;

    // Resolve actor identity in ONE query (actorId is a plain String — no FK). SYSTEM_ACTOR_ID
    // matches no User, so it resolves to null → the UI labels it "System".
    const actorIds = [...new Set(pageRows.map((r) => r.actorId))];
    const users =
      actorIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const items = pageRows.map((r) => {
      const u = byId.get(r.actorId);
      return {
        id: r.id,
        actorId: r.actorId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        diff: r.diff ?? null,
        timestamp: r.timestamp.toISOString(),
        actorName: u?.name ?? null,
        actorEmail: u?.email ?? null,
      };
    });

    return { items, nextCursor };
  }

  /** Recent window + result cap for the observed-apps picker. */
  private static readonly OBSERVED_APPS_WINDOW_DAYS = 30;
  private static readonly OBSERVED_APPS_LIMIT = 200;

  /**
   * Distinct app names the team's fleet reported in the last 30 days, ranked by total minutes.
   * Reads the KEYS of `activity_daily_summaries.byApp` (the worker's per-app rollup) — the small
   * UNPARTITIONED table — rather than a DISTINCT scan of the monthly-partitioned raw samples.
   * Team-scoped via the users subquery; no client-supplied team/user.
   */
  async listObservedApps(teamId: string): Promise<string[]> {
    const since = new Date(
      Date.now() - AdminRepository.OBSERVED_APPS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.prisma.$queryRaw<{ appName: string }[]>`
      SELECT kv.key AS "appName"
      FROM "activity_daily_summaries" ads,
           LATERAL jsonb_each_text(ads."byApp"::jsonb) AS kv(key, value)
      WHERE ads."userId" IN (SELECT "id" FROM "users" WHERE "teamId" = ${teamId})
        AND ads."day" >= ${since}
      GROUP BY kv.key
      ORDER BY SUM(kv.value::int) DESC, kv.key ASC
      LIMIT ${AdminRepository.OBSERVED_APPS_LIMIT}`;
    return rows.map((r) => r.appName);
  }

  async getSettings(teamId: string): Promise<unknown> {
    const row = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { settings: true },
    });
    return row?.settings ?? {};
  }

  async writeSettings(
    teamId: string,
    settings: TeamSettings,
    diff: { before: TeamSettings; after: TeamSettings },
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: teamId },
        data: { settings },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'team.update_settings',
          targetType: 'team',
          targetId: teamId,
          diff,
        },
      });
    });
  }

  /** Page size for export streaming — large enough to be efficient, small enough to bound memory. */
  private static readonly EXPORT_BATCH = 500;

  exportUserHeader(id: string): Promise<{
    id: string;
    email: string;
    name: string;
    role: Role;
    teamId: string;
    monitoringAckAt: Date | null;
    deactivatedAt: Date | null;
    createdAt: Date;
  } | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        teamId: true,
        monitoringAckAt: true,
        deactivatedAt: true,
        createdAt: true,
      },
    });
  }

  async *streamTimeEntries(userId: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.timeEntry.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          projectId: true,
          taskId: true,
          startTime: true,
          endTime: true,
          source: true,
          note: true,
          editedById: true,
          editedAt: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      cursor = rows[rows.length - 1]?.id;
      if (!cursor) return;
    }
  }

  async *streamTimesheetApprovals(userId: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.timesheetApproval.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          totalSeconds: true,
          reviewerId: true,
          note: true,
          decidedAt: true,
          createdAt: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      cursor = rows[rows.length - 1]?.id;
      if (!cursor) return;
    }
  }

  /** Partitioned table: the PK is composite, so the cursor is the compound unique. */
  async *streamActivitySamples(userId: string): AsyncGenerator<unknown> {
    let cursor: { id: string; timestamp: Date } | undefined;
    for (;;) {
      const rows = await this.prisma.activitySample.findMany({
        where: { userId },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        ...(cursor ? { cursor: { id_timestamp: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          timestamp: true,
          appName: true,
          windowTitle: true,
          activityPct: true,
          category: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      const last = rows[rows.length - 1];
      if (!last) return;
      cursor = { id: last.id, timestamp: last.timestamp };
    }
  }

  /** Partitioned table: the PK is composite, so the cursor is the compound unique. Metadata
   *  only — never the screenshot bytes. */
  async *streamScreenshots(userId: string): AsyncGenerator<unknown> {
    let cursor: { id: string; timestamp: Date } | undefined;
    for (;;) {
      const rows = await this.prisma.screenshot.findMany({
        where: { userId },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        ...(cursor ? { cursor: { id_timestamp: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          timestamp: true,
          storageKey: true,
          thumbnailKey: true,
          blurred: true,
          status: true,
          redactedReason: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      const last = rows[rows.length - 1];
      if (!last) return;
      cursor = { id: last.id, timestamp: last.timestamp };
    }
  }

  async *streamIdleEvents(userId: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.idleEvent.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          startTime: true,
          endTime: true,
          resolvedAction: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      cursor = rows[rows.length - 1]?.id;
      if (!cursor) return;
    }
  }

  /** Small, unpartitioned rollup table. PK is composite (userId, day). */
  async *streamActivityDailySummaries(userId: string): AsyncGenerator<unknown> {
    let cursor: { userId: string; day: Date } | undefined;
    for (;;) {
      const rows = await this.prisma.activityDailySummary.findMany({
        where: { userId },
        orderBy: { day: 'asc' },
        ...(cursor ? { cursor: { userId_day: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          userId: true,
          day: true,
          avgActivityPct: true,
          activeMinutes: true,
          byApp: true,
          byCategory: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      const last = rows[rows.length - 1];
      if (!last) return;
      cursor = { userId: last.userId, day: last.day };
    }
  }

  /** Keyed by EMAIL, not userId — same table a userId-only sweep would miss. NEVER select
   *  `tokenHash` — it is live session material, not personal data. */
  async *streamInvites(email: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.invite.findMany({
        where: { email },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          teamId: true,
          expiresAt: true,
          acceptedAt: true,
          createdAt: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      cursor = rows[rows.length - 1]?.id;
      if (!cursor) return;
    }
  }

  /** Audit rows ABOUT the user: ones they performed, and ones targeting their user row. */
  async *streamAuditLog(userId: string): AsyncGenerator<unknown> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: { OR: [{ actorId: userId }, { targetType: 'user', targetId: userId }] },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: AdminRepository.EXPORT_BATCH,
        select: {
          id: true,
          actorId: true,
          action: true,
          targetType: true,
          targetId: true,
          diff: true,
          timestamp: true,
        },
      });
      for (const r of rows) yield r;
      if (rows.length < AdminRepository.EXPORT_BATCH) return;
      cursor = rows[rows.length - 1]?.id;
      if (!cursor) return;
    }
  }

  /** The guard read for erase: the target's real email + team/role, or null when unknown. */
  findForErase(id: string): Promise<{
    id: string;
    email: string;
    teamId: string;
    role: Role;
    deactivatedAt: Date | null;
  } | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, teamId: true, role: true, deactivatedAt: true },
    });
  }

  /**
   * Cheap, non-locking count of active admins on a team — the service's pre-sweep last-admin
   * check. NOT authoritative under concurrency (no FOR UPDATE); `eraseUser`'s in-transaction
   * re-check is what actually prevents the race, this just avoids the destructive S3 sweep for
   * the common non-racing case.
   */
  countActiveAdmins(teamId: string): Promise<number> {
    return this.prisma.user.count({ where: { teamId, role: 'ADMIN', deactivatedAt: null } });
  }

  /**
   * PRD §4.4 — right to erasure. ONE transaction: delete every user-owned table, tombstone the
   * `users` row, and audit — so a partial erase can never commit (CLAUDE.md §4).
   *
   * `email` is the user's REAL address, captured by the caller before this runs: `invites` is
   * keyed by email (not userId) and holds their real name+email, so a userId-only sweep would
   * leave PII behind. `deletedObjects` is the count the caller's S3 prefix sweep already removed
   * (objects go first — see the service).
   */
  async eraseUser(
    userId: string,
    email: string,
    actorId: string,
    reason: string,
    deletedObjects: number,
  ): Promise<EraseResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // Authoritative last-admin re-check. FOR UPDATE serializes concurrent erases/deactivations
        // so two requests cannot each read "2 admins" and both proceed to zero.
        const target = await tx.user.findUnique({
          where: { id: userId },
          select: { teamId: true, role: true, deactivatedAt: true },
        });
        if (target && target.role === 'ADMIN' && target.deactivatedAt === null) {
          const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "users"
          WHERE "teamId" = ${target.teamId} AND "role"::text = 'ADMIN' AND "deactivatedAt" IS NULL
          FOR UPDATE`;
          if (activeAdmins.length <= 1) return { status: 'LAST_ADMIN' as const };
        }

        const counts: EraseCounts = {
          refreshTokens: (await tx.refreshToken.deleteMany({ where: { userId } })).count,
          timeEntries: (await tx.timeEntry.deleteMany({ where: { userId } })).count,
          timesheetApprovals: (await tx.timesheetApproval.deleteMany({ where: { userId } })).count,
          activitySamples: (await tx.activitySample.deleteMany({ where: { userId } })).count,
          screenshots: (await tx.screenshot.deleteMany({ where: { userId } })).count,
          idleEvents: (await tx.idleEvent.deleteMany({ where: { userId } })).count,
          activityDailySummaries: (await tx.activityDailySummary.deleteMany({ where: { userId } }))
            .count,
          // Keyed by EMAIL — the table a userId sweep misses.
          invites: (await tx.invite.deleteMany({ where: { email } })).count,
        };

        await tx.user.update({
          where: { id: userId },
          data: {
            email: `erased-${userId}@erased.invalid`, // .invalid is RFC-2606 reserved; email is @unique
            name: 'Erased user',
            passwordHash: ERASED_PASSWORD_HASH,
            monitoringAckAt: null, // PRD §4.1 — null means monitoring MUST NOT run
            deactivatedAt: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            actorId,
            action: 'user.erase',
            targetType: 'user',
            targetId: userId,
            // Counts + reason ONLY. Never the erased email/name: re-recording the PII we just
            // destroyed into a row we keep forever would defeat the erasure.
            diff: { reason, deleted: counts, deletedObjects },
          },
        });

        return { status: 'OK' as const, counts };
      },
      // A long-tenured user's activity_samples/screenshots (monthly-partitioned) can be
      // hundreds of thousands of rows; the default 5s interactive-transaction timeout would
      // roll the erase back (P2028) AFTER the caller's S3 sweep already ran, so erasure could
      // never complete for exactly the heaviest users. Give the delete sweep generous headroom.
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
