import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
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

/**
 * CLAUDE.md §3 — controllers hold HTTP + guards + validation. No business logic.
 * No Prisma. Ever.
 */
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly service: TimeEntriesService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateTimeEntrySchema))
  upsert(@Body() dto: CreateTimeEntry, @CurrentUser() user: SessionUser): Promise<TimeEntry> {
    // Idempotent on the client-minted UUIDv7 (PRD §7.5): a retried offline
    // batch is a no-op, not a duplicate.
    return this.service.upsert(dto, user);
  }

  @Get()
  @UsePipes(new ZodValidationPipe(ListTimeEntriesQuerySchema))
  list(@Query() query: ListTimeEntriesQuery, @CurrentUser() user: SessionUser): Promise<TimeEntry[]> {
    // Authorization is checked against the RESOURCE, not just the role.
    // The service throws 403 if `query.userId` is not visible to `user`.
    return this.service.list(query, user);
  }
}
