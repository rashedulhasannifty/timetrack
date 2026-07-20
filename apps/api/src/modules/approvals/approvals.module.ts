import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';
import { ApprovalsRepository } from './approvals.repository.js';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
