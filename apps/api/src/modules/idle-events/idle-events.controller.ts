import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  IdleEventSchema,
  ListIdleEventsQuerySchema,
  type IdleEvent,
  type IdleEventResult,
  type ListIdleEventsQuery,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceScope } from '../../common/decorators/resource-scope.decorator.js';
import { IdleEventsService } from './idle-events.service.js';

/**
 * CLAUDE.md §3 — HTTP + guards + validation only. No business logic, no Prisma.
 * Self-attributed like activity samples: the event is always the caller's, so there
 * is no @ResourceScope (no userId in the body to scope). The Zod pipe is scoped to
 * the @Body parameter, never method-level @UsePipes.
 */
@Controller('idle-events')
export class IdleEventsController {
  constructor(private readonly service: IdleEventsService) {}

  // Default 201 (NOT 202): the client's TimeEntryUploader.classify() treats only
  // 200/201 as .success; a 202 would be reclassified transient and never removed.
  @Post()
  ingest(
    @Body(new ZodValidationPipe(IdleEventSchema)) event: IdleEvent,
    @CurrentUser() user: SessionUser,
  ): Promise<IdleEventResult> {
    return this.service.ingest(event, user);
  }

  /** Self / manager-of-team / admin enforced by ResourceGuard against `?userId=`. */
  @Get()
  @ResourceScope({ source: 'query', key: 'userId' })
  list(
    @Query(new ZodValidationPipe(ListIdleEventsQuerySchema)) query: ListIdleEventsQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<IdleEvent[]> {
    return this.service.list(query, user);
  }
}
