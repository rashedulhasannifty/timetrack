import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  CreateTimeEntrySchema,
  ListTimeEntriesQuerySchema,
  type CreateTimeEntry,
  type ListTimeEntriesQuery,
  type TimeEntry,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TimeEntriesService } from './time-entries.service.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceScope } from '../../common/decorators/resource-scope.decorator.js';

/**
 * CLAUDE.md §3 — controllers hold HTTP + guards + validation. No business logic.
 * No Prisma. Ever. The Zod pipe is scoped to the input parameter (never method-level
 * @UsePipes, which would also validate @CurrentUser/@Param).
 */
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly service: TimeEntriesService) {}

  @Post()
  upsert(
    @Body(new ZodValidationPipe(CreateTimeEntrySchema)) dto: CreateTimeEntry,
    @CurrentUser() user: SessionUser,
  ): Promise<TimeEntry> {
    // Idempotent on the client-minted UUIDv7 (PRD §7.5): a retried offline
    // batch is a no-op, not a duplicate.
    return this.service.upsert(dto, user);
  }

  @Get()
  // Resource authorization by annotation: the ResourceGuard enforces self / manager-of-team
  // / admin against `?userId=` before the handler runs — no per-route check needed.
  @ResourceScope({ source: 'query', key: 'userId' })
  list(
    @Query(new ZodValidationPipe(ListTimeEntriesQuerySchema)) query: ListTimeEntriesQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TimeEntry[]> {
    return this.service.list(query, user);
  }
}
