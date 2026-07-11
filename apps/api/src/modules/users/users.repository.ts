import { Injectable } from '@nestjs/common';
import type { User } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByTeam(teamId: string): Promise<User[]> {
    const rows = await this.prisma.user.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
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
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      teamId: r.teamId,
      monitoringAckAt: r.monitoringAckAt?.toISOString() ?? null,
      deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // TODO(scaffold): invite(dto) — create user with a pending password, send invite email
  //                 via the worker's email queue.
  // TODO(scaffold): ackMonitoring(userId, policyVersion) — set monitoring_ack_at = now().
  //                 This is the ONLY writer of that column (PRD §4.1).
}
