import { Module } from '@nestjs/common';
import { PartitionsModule } from '../../common/partitions/partitions.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivitySummaryController } from './activity-summary.controller.js';
import { ActivityService } from './activity.service.js';
import { ActivityRepository } from './activity.repository.js';

@Module({
  imports: [PartitionsModule],
  controllers: [ActivityController, ActivitySummaryController],
  providers: [ActivityService, ActivityRepository],
  exports: [ActivityService],
})
export class ActivityModule {}
