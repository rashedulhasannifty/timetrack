import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateManualTimeEntrySchema,
  CreateTimeEntrySchema,
  ListTimeEntriesQuerySchema,
  UpdateTimeEntrySchema,
  type CreateManualTimeEntry,
  type CreateTimeEntry,
  type ListTimeEntriesQuery,
  type TimeEntry,
  type UpdateTimeEntry,
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

  /**
   * The dashboard's "add time". A separate route from the sync upsert above on purpose: the
   * two are different acts. This one forces source=MANUAL, refuses an overlap and a future
   * end, and audits the write; the sync path is idempotent, tolerates overlap, and is not
   * audited because it is a device reporting normal operation, not a person asserting time.
   *
   * No @ResourceScope: the optional target userId is authorized in the service, which is
   * where the self / manager-of-team / admin rule lives for every row-owner check.
   */
  @Post('manual')
  createManual(
    @Body(new ZodValidationPipe(CreateManualTimeEntrySchema)) dto: CreateManualTimeEntry,
    @CurrentUser() user: SessionUser,
  ): Promise<TimeEntry> {
    return this.service.createManual(dto, user);
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

  @Patch(':id')
  // No @ResourceScope: the owning userId is on the row, not in the request. The service
  // fetches the entry and enforces owner / manager-of-team / admin via ResourceAccessService.
  edit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTimeEntrySchema)) dto: UpdateTimeEntry,
    @CurrentUser() user: SessionUser,
  ): Promise<TimeEntry> {
    return this.service.edit(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  // Same shape as edit: the owning userId is on the row, so the service authorizes it. The
  // repository writes the AuditLog row in the same transaction as the delete.
  remove(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.service.remove(id, user);
  }
}
