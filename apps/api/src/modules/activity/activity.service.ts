import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
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
import { PartitionRangeService } from '../../common/partitions/partition-range.service.js';
import { ActivityRepository } from './activity.repository.js';

@Injectable()
export class ActivityService {
  constructor(
    private readonly repo: ActivityRepository,
    private readonly partitions: PartitionRangeService,
    private readonly logger: Logger,
  ) {}

  /**
   * Samples are always attributed to the authenticated user — the client cannot
   * post activity for anyone else. Roll-ups into per-day/week summaries are done by
   * the worker's rollup-daily job (PRD §6.3), not inline.
   *
   * A sample whose `timestamp` has no partition to land in (a month retention already dropped,
   * a clock far ahead) or is more than a day in the future is DROPPED, not inserted: one such
   * sample would otherwise fail the whole createMany, 500 the batch, and the client — which
   * deletes a batch only on 2xx — would re-send it forever. Such a sample can never be stored,
   * so accepting the batch is the only way the client's queue moves. `accepted` counts only
   * what was inserted, as before.
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
    const accepts = await this.partitions.acceptor('activity_samples');
    const kept: ActivitySample[] = [];
    const droppedTimes: string[] = [];
    for (const s of batch.samples) {
      if (accepts(new Date(s.timestamp))) kept.push(s);
      else droppedTimes.push(s.timestamp);
    }
    droppedTimes.sort();
    if (droppedTimes.length > 0) {
      // Timestamps only — never sample content (windowTitle is sensitive).
      this.logger.warn(
        {
          userId: user.id,
          received: batch.samples.length,
          dropped: droppedTimes.length,
          oldestDropped: droppedTimes[0],
          newestDropped: droppedTimes[droppedTimes.length - 1],
        },
        'activity samples outside the stored partition range dropped',
      );
    }
    if (kept.length === 0) return { accepted: 0 };

    const samples = settings.captureWindowTitles
      ? kept
      : kept.map((s) => ({ ...s, windowTitle: null }));
    try {
      return { accepted: await this.repo.insertBatch(user.id, samples) };
    } catch (err) {
      // The cached ranges may be stale (a partition dropped since they were read) — re-read
      // them on the client's retry rather than keep letting the same sample through.
      this.partitions.invalidate('activity_samples');
      throw err;
    }
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
