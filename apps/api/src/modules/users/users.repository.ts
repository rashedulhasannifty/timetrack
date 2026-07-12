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

export type SetActiveResult = { status: 'OK'; user: User } | { status: 'LAST_ADMIN' };

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

  /**
   * One atomic tx: flip deactivatedAt, revoke live refresh tokens on deactivate, and audit.
   * When deactivating a currently-active ADMIN, a `SELECT ... FOR UPDATE` on the team's active
   * admins runs FIRST — it serializes concurrent deactivations so two requests can't each read
   * "2 admins" and both proceed to zero. Returns LAST_ADMIN (no writes) when this would remove
   * the team's final active admin.
   */
  async setActive(id: string, deactivated: boolean, actorId: string): Promise<SetActiveResult> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (deactivated) {
        const target = await tx.user.findUnique({
          where: { id },
          select: { teamId: true, role: true, deactivatedAt: true },
        });
        if (target && target.role === 'ADMIN' && target.deactivatedAt === null) {
          const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "users"
            WHERE "teamId" = ${target.teamId} AND "role"::text = 'ADMIN' AND "deactivatedAt" IS NULL
            FOR UPDATE`;
          if (activeAdmins.length <= 1) return { status: 'LAST_ADMIN' as const };
        }
      }
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
      return { status: 'OK' as const, user: toUser(user) };
    });
  }
}
