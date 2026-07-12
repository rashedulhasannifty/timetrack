import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  TeamOverviewSchema,
  type ReportRangeQuery,
  type TeamOverview,
  type TeamOverviewQuery,
  type TeamSummary,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ReportsRepository } from './reports.repository.js';

const DAY_MS = 86_400_000;

@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  async overview(query: TeamOverviewQuery, user: SessionUser): Promise<TeamOverview> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    // EMPLOYEE sees only themselves; MANAGER/ADMIN see their own team. The scope is fixed
    // by the actor's identity — no client parameter can widen it (CLAUDE.md §4).
    const rows =
      user.role === 'EMPLOYEE'
        ? await this.repo.overviewForSelf(user.id, dayStart, dayEnd)
        : await this.repo.overviewForTeam(user.teamId, dayStart, dayEnd);

    return TeamOverviewSchema.parse({ date, rows });
  }

  teamSummary(_query: ReportRangeQuery, _user: SessionUser): Promise<TeamSummary> {
    // TODO(scaffold): resolve the visible scope (own team for MANAGER, anyone for ADMIN),
    //                 then aggregate via ReportsRepository.
    throw new NotImplementedException('reports.teamSummary not yet implemented');
  }

  exportCsv(_query: ReportRangeQuery, _user: SessionUser): Promise<string> {
    // TODO(scaffold): stream RFC 4180 CSV rows; never buffer the whole set.
    throw new NotImplementedException('reports.exportCsv not yet implemented');
  }
}
