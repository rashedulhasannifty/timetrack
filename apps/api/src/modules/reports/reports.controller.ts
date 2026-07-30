import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  AppUsageQuerySchema,
  ReportRangeQuerySchema,
  TeamOverviewQuerySchema,
  type AppUsageQuery,
  type ReportRangeQuery,
  type TeamActivity,
  type TeamAppUsage,
  type TeamOverview,
  type TeamOverviewQuery,
  type TeamSummary,
  type ProjectSummary,
  type TeamTrends,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@Roles('MANAGER', 'ADMIN')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('overview')
  @Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
  overview(
    @Query(new ZodValidationPipe(TeamOverviewQuerySchema)) query: TeamOverviewQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamOverview> {
    return this.service.overview(query, user);
  }

  @Get('team-summary')
  teamSummary(
    @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamSummary> {
    return this.service.teamSummary(query, user);
  }

  @Get('projects')
  projects(
    @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ProjectSummary> {
    return this.service.projects(query, user);
  }

  @Get('trends')
  trends(
    @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamTrends> {
    return this.service.trends(query, user);
  }

  @Get('team-activity')
  teamActivity(
    @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamActivity> {
    return this.service.teamActivity(query, user);
  }

  @Get('app-usage')
  appUsage(
    @Query(new ZodValidationPipe(AppUsageQuerySchema)) query: AppUsageQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TeamAppUsage> {
    return this.service.appUsage(query, user);
  }

  @Get('export.csv')
  async exportCsv(
    @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<StreamableFile> {
    const iterable = await this.service.exportCsv(query, user);
    const filename = `timetrack-export-${query.from.slice(0, 10)}_${query.to.slice(0, 10)}.csv`;
    const stream = Readable.from(iterable, { objectMode: false });
    return new StreamableFile(stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
