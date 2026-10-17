import { Injectable } from '@nestjs/common';
import type {
  ActivityBatch,
  ActivityDailySummary,
  ActivityIngestResult,
  ActivitySample,
  ListActivityQuery,
  ListActivitySummaryQuery,
  TeamSettings,
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
   *
   * PRD §13 — a team that opts out of window titles never has one stored, whatever the client
   * sends: the title is nulled here rather than rejecting the batch, so the rest of the sample
   * (app, activity level) is still recorded.
   */
  async ingest(
    batch: ActivityBatch,
    user: SessionUser,
    settings: Pick<TeamSettings, 'captureWindowTitles'>,
  ): Promise<ActivityIngestResult> {
    const samples = settings.captureWindowTitles
      ? batch.samples
      : batch.samples.map((s) => ({ ...s, windowTitle: null }));
    const accepted = await this.repo.insertBatch(user.id, samples);
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
