import { Controller, Get, Query } from '@nestjs/common';
import {
  ListActivitySummaryQuerySchema,
  type ActivityDailySummary,
  type ListActivitySummaryQuery,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceScope } from '../../common/decorators/resource-scope.decorator.js';
import { ActivityService } from './activity.service.js';

@Controller('activity-summaries')
export class ActivitySummaryController {
  constructor(private readonly service: ActivityService) {}

  /**
   * Resource authorization by annotation: the ResourceGuard enforces self / manager-of-team /
   * admin against `?userId=` before the handler runs (identical to activity-samples).
   */
  @Get()
  @ResourceScope({ source: 'query', key: 'userId' })
  list(
    @Query(new ZodValidationPipe(ListActivitySummaryQuerySchema)) query: ListActivitySummaryQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ActivityDailySummary[]> {
    return this.service.listSummaries(query, user);
  }
}
