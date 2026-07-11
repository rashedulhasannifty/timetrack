import { Body, Controller, Get, Param, Post, UsePipes } from '@nestjs/common';
import {
  AckMonitoringSchema,
  InviteUserSchema,
  type AckMonitoring,
  type InviteUser,
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

  @Post('invite')
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(InviteUserSchema))
  invite(@Body() dto: InviteUser, @CurrentUser() actor: SessionUser): Promise<User> {
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
