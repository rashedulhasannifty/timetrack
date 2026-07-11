import { Injectable } from '@nestjs/common';
import type { CreateTimeEntry, ListTimeEntriesQuery, TimeEntry } from '@timetrack/contracts';
import { TimeEntriesRepository } from './time-entries.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

/**
 * CLAUDE.md §3 — services hold business logic. No Prisma; go through the repository.
 * Resource authorization is enforced by `@ResourceScope` on the controller (the global
 * ResourceGuard), so the service does not re-implement the self/team/admin rule.
 */
@Injectable()
export class TimeEntriesService {
  constructor(private readonly repo: TimeEntriesRepository) {}

  upsert(dto: CreateTimeEntry, user: SessionUser): Promise<TimeEntry> {
    // A time entry is always attributed to the authenticated user (no cross-user writes).
    return this.repo.upsert(dto, user.id);
  }

  list(query: ListTimeEntriesQuery, user: SessionUser): Promise<TimeEntry[]> {
    const targetId = query.userId ?? user.id;
    return this.repo.list({ ...query, userId: targetId });
  }
}
