import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * CLAUDE.md §3 — Prisma lives in *.repository.ts. The single team-membership lookup
 * behind resource authorization; shared so every module answers "is X on my team?"
 * the same way.
 */
@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isInTeam(userId: string, teamId: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { id: userId, teamId } });
    return count > 0;
  }
}
