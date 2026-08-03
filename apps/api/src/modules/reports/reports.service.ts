import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  ProjectSummarySchema,
  TeamActivitySchema,
  TeamAppUsageSchema,
  TeamOverviewSchema,
  TeamSummarySchema,
  TeamTrendsSchema,
  type AppUsageQuery,
  type ProjectSummary,
  type ReportRangeQuery,
  type TeamActivity,
  type TeamAppUsage,
  type TeamOverview,
  type TeamOverviewQuery,
  type TeamSummary,
  type TeamTrends,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import { ReportsRepository, type ReportScope } from './reports.repository.js';
import { csvHeaderLine, formatCsvRow } from './csv-writer.js';
import { TRACKING_FRESHNESS_SECONDS } from './reports.tokens.js';

const DAY_MS = 86_400_000;

@Injectable()
export class ReportsService {
  // All three params carry an explicit @Inject token. Mixing a token-injected param with
  // bare class-typed params breaks under this repo's vitest e2e transform (esbuild, no
  // `emitDecoratorMetadata`/design:paramtypes — see app-bootstrap.e2e-spec.ts): once Nest
  // sees ANY explicit @Inject on the constructor it stops falling back to type reflection
  // for the others, and they resolve to nothing. Explicit tokens on all three keep
  // resolution metadata-independent.
  constructor(
    @Inject(ReportsRepository) private readonly repo: ReportsRepository,
    @Inject(ResourceAccessService) private readonly access: ResourceAccessService,
    @Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number,
  ) {}

  async overview(query: TeamOverviewQuery, user: SessionUser): Promise<TeamOverview> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    // EMPLOYEE sees only themselves; MANAGER/ADMIN see their own team. The scope is fixed
    // by the actor's identity — no client parameter can widen it (CLAUDE.md §4).
    const rows =
      user.role === 'EMPLOYEE'
        ? await this.repo.overviewForSelf(user.id, dayStart, dayEnd, this.trackingFreshnessSeconds)
        : await this.repo.overviewForTeam(
            user.teamId,
            dayStart,
            dayEnd,
            this.trackingFreshnessSeconds,
          );

    return TeamOverviewSchema.parse({ date, rows });
  }

  private async resolveScope(query: ReportRangeQuery, user: SessionUser): Promise<ReportScope> {
    if (query.userId) {
      await this.access.assertCanAccessUser(user, query.userId); // throws 403 if not permitted
      return { kind: 'user', userId: query.userId };
    }
    if (query.teamId) {
      if (user.role === 'ADMIN') return { kind: 'team', teamId: query.teamId };
      if (user.role === 'MANAGER' && query.teamId === user.teamId) {
        return { kind: 'team', teamId: user.teamId };
      }
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Not permitted to report on this team',
        status: 403,
      });
    }
    if (user.role === 'ADMIN') return { kind: 'all' };
    return { kind: 'team', teamId: user.teamId };
  }

  async teamSummary(query: ReportRangeQuery, user: SessionUser): Promise<TeamSummary> {
    const scope = await this.resolveScope(query, user);
    const rows = await this.repo.teamSummary(scope, new Date(query.from), new Date(query.to));
    return TeamSummarySchema.parse({ from: query.from, to: query.to, rows });
  }

  async projects(query: ReportRangeQuery, user: SessionUser): Promise<ProjectSummary> {
    const scope = await this.resolveScope(query, user);
    const rows = await this.repo.projects(
      scope,
      new Date(query.from),
      new Date(query.to),
      query.projectId,
    );
    return ProjectSummarySchema.parse({ from: query.from, to: query.to, rows });
  }

  async trends(query: ReportRangeQuery, user: SessionUser): Promise<TeamTrends> {
    const scope = await this.resolveScope(query, user);
    const days = await this.repo.trends(scope, new Date(query.from), new Date(query.to));
    return TeamTrendsSchema.parse({ from: query.from, to: query.to, days });
  }

  async teamActivity(query: ReportRangeQuery, user: SessionUser): Promise<TeamActivity> {
    const scope = await this.resolveScope(query, user);
    const rows = await this.repo.teamActivity(scope, new Date(query.from), new Date(query.to));
    return TeamActivitySchema.parse({ from: query.from, to: query.to, rows });
  }

  async appUsage(query: AppUsageQuery, user: SessionUser): Promise<TeamAppUsage> {
    const scope = await this.resolveScope(query, user);
    const rows = await this.repo.appUsage(
      scope,
      new Date(query.from),
      new Date(query.to),
      query.limit,
    );
    return TeamAppUsageSchema.parse({ from: query.from, to: query.to, rows });
  }

  /**
   * Resolves + authorizes the scope FIRST (a 403 is thrown here, before any byte is
   * written, so the global filter can still emit problem+json), then returns an async
   * iterable that streams the CSV header followed by one line per time entry. The
   * controller pipes this into a StreamableFile; nothing is buffered.
   */
  async exportCsv(query: ReportRangeQuery, user: SessionUser): Promise<AsyncIterable<string>> {
    const scope = await this.resolveScope(query, user);
    const from = new Date(query.from);
    const to = new Date(query.to);
    return this.generateCsv(scope, from, to, query.projectId);
  }

  private async *generateCsv(
    scope: ReportScope,
    from: Date,
    to: Date,
    projectId?: string,
  ): AsyncGenerator<string> {
    yield csvHeaderLine();
    for await (const row of this.repo.streamEntries(scope, from, to, projectId)) {
      yield formatCsvRow(row);
    }
  }
}
