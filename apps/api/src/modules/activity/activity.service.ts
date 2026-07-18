import { Injectable } from '@nestjs/common';
import type {
  ActivityBatch,
  ActivityDailySummary,
  ActivityIngestResult,
  ActivitySample,
  ListActivityQuery,
  ListActivitySummaryQuery,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ActivityRepository } from './activity.repository.js';

@Injectable()
export class ActivityService {
  constructor(private readonly repo: ActivityRepository) {}

  /**
   * Samples are always attributed to the authenticated user — the client cannot
   * post activity for anyone else. Roll-ups into per-day/week summaries are done by
   * the worker's rollup-daily job (PRD §6.3), not inline.
   */
  async ingest(batch: ActivityBatch, user: SessionUser): Promise<ActivityIngestResult> {
    const accepted = await this.repo.insertBatch(user.id, batch.samples);
    return { accepted };
  }

  /**
   * PRD §4.3 — symmetric transparency: an employee lists every sample recorded about
   * them through this same endpoint (scoped to self). Manager-of-team / admin scope is
   * enforced by @ResourceScope on the controller (ResourceGuard) before we run.
   */
  list(query: ListActivityQuery, user: SessionUser): Promise<ActivitySample[]> {
    const targetId = query.userId ?? user.id;
    return this.repo.list({ ...query, userId: targetId });
  }

  /**
   * PRD §4.3 — symmetric transparency: an employee reads their own daily rollups through
   * the same endpoint managers use. @ResourceScope on the controller enforces the scope.
   */
  listSummaries(
    query: ListActivitySummaryQuery,
    user: SessionUser,
  ): Promise<ActivityDailySummary[]> {
    const targetId = query.userId ?? user.id;
    return this.repo.listSummaries({ userId: targetId, from: query.from, to: query.to });
  }
}
