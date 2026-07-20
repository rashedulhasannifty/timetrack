import { Injectable } from '@nestjs/common';
import type { AuditLogPage, AuditLogQuery, TeamSettings } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

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

  // TODO(scaffold): eraseUser(userId, actorId, reason) — hard-delete user data AND write
  //                 an AuditLog row in the SAME transaction (CLAUDE.md §4, PRD §4.4).
}
