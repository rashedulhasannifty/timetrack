import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AckMonitoringSchema,
  InviteUserSchema,
  UpdateUserSchema,
  type AckMonitoring,
  type InviteResult,
  type InviteUser,
  type UpdateUser,
  type User,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Roles('MANAGER', 'ADMIN')
  list(@CurrentUser() user: SessionUser): Promise<User[]> {
    return this.service.list(user);
  }

  // ADMIN-scoped management, not user-self-scoped: an admin flips another user's
  // active state. No @ResourceScope — the service enforces same-team + self/last-admin
  // guards directly since the "resource" here isn't the caller's own record.
  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUser,
    @CurrentUser() actor: SessionUser,
  ): Promise<User> {
    return this.service.setActive(id, dto, actor);
  }

  @Post('invite')
  @Roles('ADMIN')
  invite(
    @Body(new ZodValidationPipe(InviteUserSchema)) dto: InviteUser,
    @CurrentUser() actor: SessionUser,
  ): Promise<InviteResult> {
    return this.service.invite(dto, actor);
  }

  /** PRD §4.1 — the client calls this once the employee acknowledges the policy. */
  @Post(':id/ack-monitoring')
  ackMonitoring(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AckMonitoringSchema)) dto: AckMonitoring,
    @CurrentUser() actor: SessionUser,
  ): Promise<User> {
    return this.service.ackMonitoring(id, dto, actor);
  }
}
