import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  BulkCreateWorkTypesSchema,
  SetTeamWorkTypesSchema,
  UpdateWorkTypeSchema,
  type BulkCreateWorkTypes,
  type BulkCreateWorkTypesResult,
  type ReconcileCounts,
  type SetTeamWorkTypes,
  type TeamWorkTypes,
  type UpdateWorkType,
  type WorkType,
  type WorkTypeWithTeams,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { WorkTypesService } from './work-types.service.js';

/**
 * ADMIN-only, org-wide (spec §6). Deliberately no `@ResourceScope` (CLAUDE.md §8.6): the catalog
 * and team selections have no owning user to scope against, so `@Roles('ADMIN')` IS the
 * authorization — the same gate the Teams admin routes rely on.
 */
@Controller('work-types')
export class WorkTypesController {
  constructor(private readonly service: WorkTypesService) {}

  @Get()
  @Roles('ADMIN')
  list(): Promise<WorkTypeWithTeams[]> {
    return this.service.list();
  }

  @Post('bulk')
  @Roles('ADMIN')
  bulkCreate(
    @Body(new ZodValidationPipe(BulkCreateWorkTypesSchema)) dto: BulkCreateWorkTypes,
    @CurrentUser() actor: SessionUser,
  ): Promise<BulkCreateWorkTypesResult> {
    return this.service.bulkCreate(dto, actor);
  }

  @Post('resync')
  @Roles('ADMIN')
  resync(@CurrentUser() actor: SessionUser): Promise<ReconcileCounts> {
    return this.service.resync(actor);
  }

  @Put('teams/:teamId')
  @Roles('ADMIN')
  setTeamSelection(
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(SetTeamWorkTypesSchema)) dto: SetTeamWorkTypes,
    @CurrentUser() actor: SessionUser,
  ): Promise<TeamWorkTypes> {
    return this.service.setTeamSelection(teamId, dto, actor);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkTypeSchema)) dto: UpdateWorkType,
    @CurrentUser() actor: SessionUser,
  ): Promise<WorkType> {
    return this.service.update(id, dto, actor);
  }
}
