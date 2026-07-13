import { Injectable } from '@nestjs/common';
import type { IdleEvent, IdleEventResult } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { IdleEventsRepository } from './idle-events.repository.js';

/**
 * CLAUDE.md §3 — business logic, no Prisma. An idle event is always attributed to
 * the authenticated user; like activity samples the client cannot post for anyone
 * else, so there is no @ResourceScope to enforce.
 */
@Injectable()
export class IdleEventsService {
  constructor(private readonly repo: IdleEventsRepository) {}

  ingest(event: IdleEvent, user: SessionUser): Promise<IdleEventResult> {
    return this.repo.upsert(event, user.id);
  }
}
