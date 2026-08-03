import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  AuditLogQuerySchema,
  EraseUserSchema,
  UpdateSettingsSchema,
  type AuditLogPage,
  type AuditLogQuery,
  type EraseUser,
  type ObservedApps,
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
  auditLog(
    @Query(new ZodValidationPipe(AuditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogPage> {
    return this.service.listAudit(query);
  }

  @Get('observed-apps')
  observedApps(@CurrentUser() actor: SessionUser): Promise<ObservedApps> {
    return this.service.listObservedApps(actor);
  }

  @Patch('settings')
  updateSettings(
    @Body(new ZodValidationPipe(UpdateSettingsSchema)) patch: UpdateSettings,
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

  @Get('users/:id/export')
  async exportUser(
    @Param('id') id: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<StreamableFile> {
    const iterable = await this.service.exportUser(id, actor);
    return new StreamableFile(Readable.from(iterable, { objectMode: false }), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="timetrack-user-${id}-export.json"`,
    });
  }
}
