import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  dayOf,
  dayStartInstant,
  monthStartDay,
  shiftDay,
  weekStartDay,
  ProjectSummarySchema,
  TeamActivitySchema,
  TeamAppUsageSchema,
  SelfTotalsSchema,
  TeamOverviewSchema,
  TeamSummarySchema,
  TeamTrendsSchema,
  type AppUsageQuery,
  type ProjectSummary,
  type ReportRangeQuery,
  type SelfTotals,
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
    // `query.date` is already constrained to a real 'YYYY-MM-DD' calendar date by
    // TeamOverviewQuerySchema's `z.iso.date()` (rejects e.g. '2026-02-30' the same way
    // `isValidDay` does) before the controller's ZodValidationPipe lets it reach here, so
    // `dayStartInstant`/`shiftDay` — which throw on a malformed label — can't throw on this
    // input. No extra guard needed.
    const date = query.date ?? dayOf(new Date());
    const dayStart = dayStartInstant(date);
    const dayEnd = dayStartInstant(shiftDay(date, 1));

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

  /**
   * The signed-in person's own today / this-week / this-month totals, for the Mac app's
   * dropdown.
   *
   * Self-scoped by IDENTITY, like `overview` above: there is no userId parameter, so no client
   * input can widen it and no `@ResourceScope` is needed on the route (CLAUDE.md §4).
   *
   * All three boundaries are resolved here, in Dhaka, and the labels are returned with the
   * numbers. The Mac client does no date arithmetic at all — a second implementation of "when
   * does the week start" living in Swift is exactly what would drift out of step with the
   * dashboard and the approvals period.
   *
   * The totals already include a currently-running entry (clamped by `ENTRY_END`), so a client
   * must NOT add its live elapsed counter on top.
   */
  async selfTotals(user: SessionUser): Promise<SelfTotals> {
    const day = dayOf(new Date());
    const weekStart = weekStartDay(day);
    const monthStart = monthStartDay(day);
    // Every range ends at the end of today: nothing can be tracked in the future, so a
    // week-to-date and the whole calendar week are the same sum.
    const end = dayStartInstant(shiftDay(day, 1));

    const [todaySeconds, weekSeconds, monthSeconds] = await Promise.all([
      this.repo.trackedSecondsForUser(
        user.id,
        dayStartInstant(day),
        end,
        this.trackingFreshnessSeconds,
      ),
      this.repo.trackedSecondsForUser(
        user.id,
        dayStartInstant(weekStart),
        end,
        this.trackingFreshnessSeconds,
      ),
      this.repo.trackedSecondsForUser(
        user.id,
        dayStartInstant(monthStart),
        end,
        this.trackingFreshnessSeconds,
      ),
    ]);

    return SelfTotalsSchema.parse({
      day,
      weekStart,
      monthStart,
      todaySeconds,
      weekSeconds,
      monthSeconds,
    });
  }

  private async resolveScope(query: ReportRangeQuery, user: SessionUser): Promise<ReportScope> {
    if (query.userId) {
      await this.access.assertCanAccessUser(user, query.userId); // throws 403 if not permitted
      return { kind: 'user', userId: query.userId };
    }
    // An EMPLOYEE is ALWAYS scoped to themselves, exactly as `overview` already does: the
    // scope is fixed by the actor's identity and no absent parameter can widen it
    // (CLAUDE.md §4). Without this, an omitted ?userId fell through to the team branch below,
    // so opening any report route to EMPLOYEE would hand them the whole team's data.
    if (user.role === 'EMPLOYEE') return { kind: 'user', userId: user.id };
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
    const rows = await this.repo.teamSummary(
      scope,
      new Date(query.from),
      new Date(query.to),
      this.trackingFreshnessSeconds,
    );
    return TeamSummarySchema.parse({ from: query.from, to: query.to, rows });
  }

  async projects(query: ReportRangeQuery, user: SessionUser): Promise<ProjectSummary> {
    const scope = await this.resolveScope(query, user);
    const rows = await this.repo.projects(
      scope,
      new Date(query.from),
      new Date(query.to),
      this.trackingFreshnessSeconds,
      query.projectId,
    );
    return ProjectSummarySchema.parse({ from: query.from, to: query.to, rows });
  }

  async trends(query: ReportRangeQuery, user: SessionUser): Promise<TeamTrends> {
    const scope = await this.resolveScope(query, user);
    const days = await this.repo.trends(
      scope,
      new Date(query.from),
      new Date(query.to),
      this.trackingFreshnessSeconds,
    );
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
    for await (const row of this.repo.streamEntries(
      scope,
      from,
      to,
      this.trackingFreshnessSeconds,
      projectId,
    )) {
      yield formatCsvRow(row);
    }
  }
}
