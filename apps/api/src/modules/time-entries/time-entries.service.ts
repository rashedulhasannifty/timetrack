import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CreateTimeEntry, ListTimeEntriesQuery, TimeEntry } from '@timetrack/contracts';
import { TimeEntriesRepository } from './time-entries.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

/**
 * CLAUDE.md §3 — services hold business logic. No Prisma; go through the repository.
 */
@Injectable()
export class TimeEntriesService {
  constructor(private readonly repo: TimeEntriesRepository) {}

  upsert(dto: CreateTimeEntry, user: SessionUser): Promise<TimeEntry> {
    return this.repo.upsert(dto, user.id);
  }

  async list(query: ListTimeEntriesQuery, user: SessionUser): Promise<TimeEntry[]> {
    const targetId = query.userId ?? user.id;
    await this.assertCanRead(targetId, user);
    return this.repo.list({ ...query, userId: targetId });
  }

  /**
   * Employees may read only themselves. Managers only their own team. Admins anyone.
   * Write the test for the 403 case, not just the 200 case.
   */
  private async assertCanRead(targetUserId: string, user: SessionUser): Promise<void> {
    if (user.role === 'ADMIN') return;
    if (targetUserId === user.id) return;
    if (user.role === 'MANAGER' && (await this.repo.isInTeam(targetUserId, user.teamId))) return;
    throw new ForbiddenException({
      type: 'https://timetrack.internal/errors/forbidden',
      title: 'Not permitted to read this user',
      status: 403,
    });
  }
}
