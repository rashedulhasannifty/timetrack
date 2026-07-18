import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { ActivitySummaryController } from './activity-summary.controller.js';
import { ActivityService } from './activity.service.js';
import { ActivityRepository } from './activity.repository.js';

@Module({
  controllers: [ActivityController, ActivitySummaryController],
  providers: [ActivityService, ActivityRepository],
  exports: [ActivityService],
})
export class ActivityModule {}
