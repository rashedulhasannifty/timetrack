import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import {
  ActivityBatchSchema,
  type ActivityBatch,
  type ActivityIngestResult,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ActivityService } from './activity.service.js';

@Controller('activity-samples')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  /** PRD §7.8 — max 500 samples per batch (enforced by ActivityBatchSchema). */
  @Post('batch')
  @HttpCode(202)
  @UsePipes(new ZodValidationPipe(ActivityBatchSchema))
  ingest(
    @Body() batch: ActivityBatch,
    @CurrentUser() user: SessionUser,
  ): Promise<ActivityIngestResult> {
    return this.service.ingest(batch, user);
  }
}
