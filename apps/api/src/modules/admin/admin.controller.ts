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

  /**
   * The actor's OWN team's policy. Kept as-is for `/v1` compatibility — anything already
   * scripted against it keeps working — but the dashboard now uses the team-scoped route
   * below, because an admin has to be able to edit a team they are not a member of.
   */
  @Patch('settings')
  updateSettings(
    @Body(new ZodValidationPipe(UpdateSettingsSchema)) patch: UpdateSettings,
    @CurrentUser() actor: SessionUser,
  ): Promise<TeamSettings> {
    return this.service.updateSettings(patch, actor);
  }

  /**
   * Any team's policy. The PRD makes the monitoring policy configurable per team, but until
   * this route existed a second team's policy was frozen at its creation defaults with no way
   * to edit it — the settings write always resolved the actor's own team.
   *
   * No `@ResourceScope` (CLAUDE.md §8.6): a team is an org-wide object with no owning user to
   * scope against, and every route on this controller is already ADMIN-gated at the class
   * level. An unknown teamId is a 404 from the service, not a silent no-op.
   */
  @Patch('teams/:teamId/settings')
  updateTeamSettings(
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(UpdateSettingsSchema)) patch: UpdateSettings,
    @CurrentUser() actor: SessionUser,
  ): Promise<TeamSettings> {
    return this.service.updateSettings(patch, actor, teamId);
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
