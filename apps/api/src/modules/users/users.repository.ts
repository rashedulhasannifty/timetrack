import { Injectable } from '@nestjs/common';
import type { Role, User } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  teamId: true,
  monitoringAckAt: true,
  deactivatedAt: true,
  createdAt: true,
} as const;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  teamId: string;
  monitoringAckAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    teamId: r.teamId,
    monitoringAckAt: r.monitoringAckAt?.toISOString() ?? null,
    deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByTeam(teamId: string): Promise<User[]> {
    const rows = await this.prisma.user.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: USER_SELECT,
    });
    return rows.map(toUser);
  }

  findForAdmin(
    id: string,
  ): Promise<{ id: string; role: Role; teamId: string; deactivatedAt: Date | null } | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, teamId: true, deactivatedAt: true },
    });
  }

  countActiveAdmins(teamId: string): Promise<number> {
    return this.prisma.user.count({ where: { teamId, role: 'ADMIN', deactivatedAt: null } });
  }

  /**
   * One atomic tx: flip deactivatedAt, revoke the user's live refresh tokens on
   * deactivate, and write the audit row. Sole writer that revokes on deactivation.
   */
  async setActive(id: string, deactivated: boolean, actorId: string): Promise<User> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { deactivatedAt: deactivated ? now : null },
        select: USER_SELECT,
      });
      if (deactivated) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: deactivated ? 'user.deactivate' : 'user.reactivate',
          targetType: 'user',
          targetId: id,
          diff: { deactivated },
        },
      });
      return toUser(user);
    });
  }
}
