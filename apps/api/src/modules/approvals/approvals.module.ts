import { Module } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';
import { ApprovalsRepository } from './approvals.repository.js';
import { TRACKING_FRESHNESS_SECONDS } from './approvals.tokens.js';

export { TRACKING_FRESHNESS_SECONDS };

@Module({
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalsRepository,
    { provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS },
  ],
})
export class ApprovalsModule {}
