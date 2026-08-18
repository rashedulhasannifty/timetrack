import { Injectable } from '@nestjs/common';
import type { TeamSettings } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface TeamRow {
  id: string;
  name: string;
  settings: unknown;
}

/** A TeamRow plus what sits in it. The list shape only — `getById` stays lean. */
export interface TeamListRow extends TeamRow {
  memberCount: number;
  projectCount: number;
}

@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  getById(id: string): Promise<TeamRow | null> {
    return this.prisma.team.findUnique({
      where: { id },
      select: { id: true, name: true, settings: true },
    });
  }

  /**
   * Every team, for the ADMIN-only picker and the Teams admin surface. Ordered by name so the
   * list is stable. The member count rides along as a `_count` on this same query — one round
   * trip for the whole list, rather than the N+1 a per-row count would cost.
   */
  async list(): Promise<TeamListRow[]> {
    const rows = await this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        settings: true,
        _count: { select: { users: true, projects: true } },
      },
    });
    return rows.map(({ _count, ...team }) => ({
      ...team,
      memberCount: _count.users,
      projectCount: _count.projects,
    }));
  }

  /**
   * Create a team and audit it in the same transaction. A team is a management boundary —
   * everyone later moved into it becomes visible to its managers — so its creation belongs in
   * the audit log next to `user.role_change`, not treated as inert reference data.
   * `settings` arrives already merged and validated by the service; this never sees a raw patch.
   */
  async create(name: string, settings: TeamSettings, actorId: string): Promise<TeamRow> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name, settings },
        select: { id: true, name: true, settings: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'team.create',
          targetType: 'team',
          targetId: team.id,
          diff: { name },
        },
      });
      return team;
    });
  }

  /**
   * Rename a team and audit it in the same transaction. The old name is read INSIDE the
   * transaction so the recorded diff is the rename that actually happened — a name read before
   * the transaction could be stale by the time the update lands. Returns null when the team is
   * gone, which the service maps to a 404.
   *
   * Policy edits do not come through here: they live on the admin settings route, which owns
   * the `team.update_settings` audit trail and the merged-settings validation.
   */
  async rename(id: string, name: string, actorId: string): Promise<TeamRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.team.findUnique({ where: { id }, select: { name: true } });
      if (!before) return null;

      const team = await tx.team.update({
        where: { id },
        data: { name },
        select: { id: true, name: true, settings: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'team.rename',
          targetType: 'team',
          targetId: id,
          diff: { before: { name: before.name }, after: { name } },
        },
      });
      return team;
    });
  }
}
