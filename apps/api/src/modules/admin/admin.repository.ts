import { Injectable } from '@nestjs/common';
import type { AuditLogEntry, AuditLogQuery } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAudit(query: AuditLogQuery): Promise<AuditLogEntry[]> {
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
      orderBy: { timestamp: 'desc' },
      take: 500,
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
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      diff: r.diff ?? null,
      timestamp: r.timestamp.toISOString(),
    }));
  }

  // TODO(scaffold): updateSettings(teamId, patch) — validate merged object via
  //                 TeamSettingsSchema, write, and record an AuditLog row in the same tx.
  // TODO(scaffold): eraseUser(userId, actorId, reason) — hard-delete user data AND write
  //                 an AuditLog row in the SAME transaction (CLAUDE.md §4, PRD §4.4).
}
