import { Injectable, NotImplementedException } from '@nestjs/common';
import type { ReportRangeQuery, TeamSummary } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

@Injectable()
export class ReportsService {
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
