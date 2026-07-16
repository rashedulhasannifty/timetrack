import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ActivityBatchSchema,
  ListActivityQuerySchema,
  type ActivityBatch,
  type ActivityIngestResult,
  type ActivitySample,
  type ListActivityQuery,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceScope } from '../../common/decorators/resource-scope.decorator.js';
import { ActivityService } from './activity.service.js';

@Controller('activity-samples')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  /** PRD §7.8 — max 500 samples per batch (enforced by ActivityBatchSchema). */
  @Post('batch')
  @HttpCode(202)
  ingest(
    @Body(new ZodValidationPipe(ActivityBatchSchema)) batch: ActivityBatch,
    @CurrentUser() user: SessionUser,
  ): Promise<ActivityIngestResult> {
    return this.service.ingest(batch, user);
  }

  /**
   * Resource authorization by annotation: the ResourceGuard enforces self / manager-of-team /
   * admin against `?userId=` before the handler runs (identical to time-entries/screenshots).
   */
  @Get()
  @ResourceScope({ source: 'query', key: 'userId' })
  list(
    @Query(new ZodValidationPipe(ListActivityQuerySchema)) query: ListActivityQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ActivitySample[]> {
    return this.service.list(query, user);
  }
}
