import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApprovalListQuerySchema,
  DecisionSchema,
  type ApprovalListQuery,
  type Decision,
  type TimesheetApproval,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ApprovalsService } from './approvals.service.js';

@Controller('approvals')
@Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ApprovalListQuerySchema)) query: ApprovalListQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TimesheetApproval[]> {
    return this.service.list(query, user);
  }

  @Post(':id/decide')
  @Roles('MANAGER', 'ADMIN')
  @HttpCode(200) // decision UPDATES an existing timesheet — not a creation (cf. users ack-monitoring)
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecisionSchema)) body: Decision,
    @CurrentUser() user: SessionUser,
  ): Promise<TimesheetApproval> {
    return this.service.decide(id, body, user);
  }
}
