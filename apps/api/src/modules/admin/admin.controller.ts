import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import {
  AuditLogQuerySchema,
  EraseUserSchema,
  UpdateSettingsSchema,
  type AuditLogEntry,
  type AuditLogQuery,
  type EraseUser,
  type TeamSettings,
  type UpdateSettings,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { AdminService } from './admin.service.js';

/** CLAUDE.md §4 — every admin route is ADMIN-only, gated at the class level. */
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('audit-log')
  @UsePipes(new ZodValidationPipe(AuditLogQuerySchema))
  auditLog(@Query() query: AuditLogQuery): Promise<AuditLogEntry[]> {
    return this.service.listAudit(query);
  }

  @Patch('settings')
  @UsePipes(new ZodValidationPipe(UpdateSettingsSchema))
  updateSettings(
    @Body() patch: UpdateSettings,
    @CurrentUser() actor: SessionUser,
  ): Promise<TeamSettings> {
    return this.service.updateSettings(patch, actor);
  }

  @Post('users/:id/erase')
  @HttpCode(204)
  eraseUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EraseUserSchema)) dto: EraseUser,
    @CurrentUser() actor: SessionUser,
  ): Promise<void> {
    return this.service.eraseUser(id, dto, actor);
  }
}
