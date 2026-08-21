import { Module } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import { TimeEntriesController } from './time-entries.controller.js';
import { TimeEntriesService } from './time-entries.service.js';
import { TimeEntriesRepository } from './time-entries.repository.js';
import { TRACKING_FRESHNESS_SECONDS } from './time-entries.tokens.js';

export { TRACKING_FRESHNESS_SECONDS };

@Module({
  controllers: [TimeEntriesController],
  providers: [
    TimeEntriesService,
    TimeEntriesRepository,
    { provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS },
  ],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
