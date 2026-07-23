import { Injectable } from '@nestjs/common';
import type { AuditLogPage, AuditLogQuery, TeamSettings } from '@timetrack/contracts';
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
    return this.prisma.$transaction(async (tx) => {
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
    });
  }
}
