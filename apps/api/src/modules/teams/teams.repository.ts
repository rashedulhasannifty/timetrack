import { Injectable } from '@nestjs/common';
import type { TeamSettings } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface TeamRow {
  id: string;
  name: string;
  settings: unknown;
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

  /** Every team, for the ADMIN-only picker. Ordered by name so the list is stable. */
  list(): Promise<TeamRow[]> {
    return this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, settings: true },
    });
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

  // TODO(scaffold): updateSettings(teamId, patch) — validate the MERGED object through
  //                 TeamSettingsSchema before writing (never persist an unvalidated patch).
}
