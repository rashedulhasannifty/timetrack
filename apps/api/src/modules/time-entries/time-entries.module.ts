import { Module } from '@nestjs/common';
import { TimeEntriesController } from './time-entries.controller.js';
import { TimeEntriesService } from './time-entries.service.js';
import { TimeEntriesRepository } from './time-entries.repository.js';

@Module({
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService, TimeEntriesRepository],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
