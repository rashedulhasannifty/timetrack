import { Injectable, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type {
  ListScreenshotsQuery,
  RedactScreenshot,
  Screenshot,
  UploadScreenshotMeta,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { MinioService } from '../../infra/storage/minio.service.js';
import { QueueService, QUEUES } from '../../infra/queue/queue.module.js';
import { ScreenshotsRepository, type ScreenshotRow } from './screenshots.repository.js';

@Injectable()
export class ScreenshotsService {
  constructor(
    private readonly repo: ScreenshotsRepository,
    private readonly storage: MinioService,
    private readonly queue: QueueService,
  ) {}

  /**
   * PRD §4.3 — symmetric transparency: an employee can list every screenshot recorded
   * about them through this same endpoint (scoped to self). Managers see their team;
   * admins see anyone — enforced by @ResourceScope on the controller (ResourceGuard).
   * Presigned URLs are added when upload/storage is wired.
   */
  async list(query: ListScreenshotsQuery, user: SessionUser): Promise<Screenshot[]> {
    const targetId = query.userId ?? user.id;
    const rows = await this.repo.listByUser(targetId, new Date(query.from), new Date(query.to));
    return Promise.all(rows.map((r) => this.withUrls(r)));
  }

  /** READY rows get presigned URLs (5-min TTL); PENDING has none yet; REDACTED never does. */
  private async withUrls(r: ScreenshotRow): Promise<Screenshot> {
    const shot = toScreenshot(r);
    if (r.status !== 'READY') return shot;
    if (r.thumbnailKey) shot.url = await this.storage.presignGet(r.thumbnailKey);
    if (r.storageKey) shot.fullUrl = await this.storage.presignGet(r.storageKey);
    return shot;
  }

  /**
   * PRD §7.4 — stream the image straight to storage (raw/<userId>/<id>), upsert a PENDING row,
   * and enqueue the derive job. Owner is ALWAYS the session user, never a body field. Idempotent:
   * a retried upload (client deletes local only after a confirmed 201) overwrites the object and
   * re-sets PENDING, so a lost-201 retry is a safe no-op.
   */
  async upload(file: Readable, meta: UploadScreenshotMeta, user: SessionUser): Promise<Screenshot> {
    const storageKey = `raw/${user.id}/${meta.id}`;
    await this.storage.putStream(storageKey, file, 'image/png');
    const row = await this.repo.create(meta, user.id, storageKey);
    await this.queue.enqueue(QUEUES.screenshotProcess, randomUUID(), {
      id: meta.id,
      timestamp: meta.timestamp,
    });
    return toScreenshot(row);
  }

  redact(_id: string, _dto: RedactScreenshot, _user: SessionUser): Promise<Screenshot> {
    // TODO(scaffold): mark REDACTED with reason; owner-only; never silently remove.
    throw new NotImplementedException('screenshots.redact not yet implemented');
  }
}

// Presigned `url` is intentionally absent until MinioService is wired into the read path.
function toScreenshot(r: ScreenshotRow): Screenshot {
  return {
    id: r.id,
    userId: r.userId,
    timestamp: r.timestamp.toISOString(),
    storageKey: r.storageKey,
    thumbnailKey: r.thumbnailKey,
    blurred: r.blurred,
    status: r.status,
    redactedReason: r.redactedReason,
  };
}
