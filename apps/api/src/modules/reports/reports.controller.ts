import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { ReportRangeQuerySchema, type ReportRangeQuery, type TeamSummary } from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@Roles('MANAGER', 'ADMIN')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('team-summary')
  @UsePipes(new ZodValidationPipe(ReportRangeQuerySchema))
  teamSummary(
    @Query() query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamSummary> {
    return this.service.teamSummary(query, user);
  }

  @Get('export.csv')
  @UsePipes(new ZodValidationPipe(ReportRangeQuerySchema))
  exportCsv(@Query() query: ReportRangeQuery, @CurrentUser() user: SessionUser): Promise<string> {
    return this.service.exportCsv(query, user);
  }
}
