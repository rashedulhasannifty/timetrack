import { Module } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportsRepository } from './reports.repository.js';
import { TRACKING_FRESHNESS_SECONDS } from './reports.tokens.js';

export { TRACKING_FRESHNESS_SECONDS };

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    { provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
