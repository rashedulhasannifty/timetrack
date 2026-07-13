import { Module } from '@nestjs/common';
import { IdleEventsController } from './idle-events.controller.js';
import { IdleEventsService } from './idle-events.service.js';
import { IdleEventsRepository } from './idle-events.repository.js';

@Module({
  controllers: [IdleEventsController],
  providers: [IdleEventsService, IdleEventsRepository],
  exports: [IdleEventsService],
})
export class IdleEventsModule {}
