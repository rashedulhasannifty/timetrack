import { Injectable } from '@nestjs/common';
import type { ActivityBatch, ActivityIngestResult } from '@timetrack/contracts';
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
}
