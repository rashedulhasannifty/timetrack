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
export type SetRoleResult = { status: 'OK'; user: User } | { status: 'LAST_ADMIN' };

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every user in the deployment — ADMIN only. An admin assigns people to managers by moving
   * them between teams, which they cannot do while the roster shows only their own team.
   * MANAGER keeps `listByTeam`.
   */
  async listAll(): Promise<User[]> {
    const rows = await this.prisma.user.findMany({
      orderBy: [{ teamId: 'asc' }, { createdAt: 'asc' }],
      select: USER_SELECT,
    });
    return rows.map(toUser);
  }

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

  /** Destination check for a team move, so a mistyped id is a 422 and not a raw FK error. */
  async teamExists(teamId: string): Promise<boolean> {
    const count = await this.prisma.team.count({ where: { id: teamId } });
    return count > 0;
  }

  /** Full User by id (for returning an unchanged record on a no-op update). */
  async findUser(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    return row ? toUser(row) : null;
  }

  /**
   * One atomic tx: flip deactivatedAt, revoke live refresh tokens on deactivate, and audit.
   * When deactivating a currently-active ADMIN, a `SELECT ... FOR UPDATE` on the ORG's active
   * admins runs FIRST — it serializes concurrent deactivations so two requests can't each read
   * "2 admins" and both proceed to zero. Returns LAST_ADMIN (no writes) when this would remove
   * the last active admin in the deployment.
   *
   * Org-wide, not per-team: an ADMIN now manages every team, so "the last admin OF A TEAM" is
   * no longer the quantity that matters. A per-team count would let the org's final admin be
   * removed as long as some other team still had one — and, worse, would treat a manager-only
   * team as needing its own admin, which under this model it never does.
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
            WHERE "role"::text = 'ADMIN' AND "deactivatedAt" IS NULL
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

  /**
   * One atomic tx: change a user's role and audit it. Demoting a currently-active ADMIN out of
   * ADMIN takes a `SELECT ... FOR UPDATE` on the ORG's active admins FIRST (same serialization
   * as setActive) so two concurrent demotions can't both leave zero admins. Returns LAST_ADMIN
   * (no writes) when this would remove the deployment's final active admin — see setActive for
   * why that count is org-wide. A no-op (role unchanged) is handled in the service and never
   * reaches here.
   */
  async setRole(id: string, role: Role, actorId: string): Promise<SetRoleResult> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { teamId: true, role: true, deactivatedAt: true },
      });
      if (target && target.role === 'ADMIN' && role !== 'ADMIN' && target.deactivatedAt === null) {
        const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "users"
          WHERE "role"::text = 'ADMIN' AND "deactivatedAt" IS NULL
          FOR UPDATE`;
        if (activeAdmins.length <= 1) return { status: 'LAST_ADMIN' as const };
      }
      const user = await tx.user.update({
        where: { id },
        data: { role },
        select: USER_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'user.role_change',
          targetType: 'user',
          targetId: id,
          diff: { role, from: target?.role ?? null },
        },
      });
      return { status: 'OK' as const, user: toUser(user) };
    });
  }

  /**
   * One atomic tx: move a user to another team and audit it. This is a PERMISSIONS change, not
   * a field edit — the old team's managers lose visibility of this person's entries, activity
   * and screenshots, and the new team's managers gain it, retroactively, because every
   * manager-scoped query resolves membership at read time. The audit row is the only record
   * that the visibility boundary moved, so it is written here rather than left to the caller.
   *
   * No last-admin guard: role is unchanged, so an ADMIN stays an ADMIN wherever they sit, and
   * (unlike the per-team model this replaced) admin authority no longer depends on team.
   * A no-op (same team) is handled in the service and never reaches here.
   */
  async setTeam(id: string, teamId: string, actorId: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { teamId: true } });
      const user = await tx.user.update({
        where: { id },
        data: { teamId },
        select: USER_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'user.team_change',
          targetType: 'user',
          targetId: id,
          diff: { to: teamId, from: target?.teamId ?? null },
        },
      });
      return toUser(user);
    });
  }

  /**
   * PRD §4.1 — sole writer of monitoring_ack_at. Sets it to now() and audits, in one tx.
   * The self-only rule is enforced in the service; there is no admin override.
   */
  async ackMonitoring(userId: string, policyVersion: string, actorId: string): Promise<User> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { monitoringAckAt: now },
        select: USER_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'user.ack_monitoring',
          targetType: 'user',
          targetId: userId,
          diff: { policyVersion },
        },
      });
      return toUser(user);
    });
  }
}
