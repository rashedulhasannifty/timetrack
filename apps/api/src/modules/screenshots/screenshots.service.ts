import { Injectable, NotImplementedException } from '@nestjs/common';
import type { ListScreenshotsQuery, RedactScreenshot, Screenshot } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ScreenshotsRepository, type ScreenshotRow } from './screenshots.repository.js';

@Injectable()
export class ScreenshotsService {
  constructor(private readonly repo: ScreenshotsRepository) {}

  /**
   * PRD §4.3 — symmetric transparency: an employee can list every screenshot recorded
   * about them through this same endpoint (scoped to self). Managers see their team;
   * admins see anyone — enforced by @ResourceScope on the controller (ResourceGuard).
   * Presigned URLs are added when upload/storage is wired.
   */
  async list(query: ListScreenshotsQuery, user: SessionUser): Promise<Screenshot[]> {
    const targetId = query.userId ?? user.id;
    const rows = await this.repo.listByUser(targetId, new Date(query.from), new Date(query.to));
    return rows.map(toScreenshot);
  }

  upload(): Promise<Screenshot> {
    // TODO(scaffold): stream multipart → MinioService.putObject → create row PENDING →
    //                 enqueue screenshot-process → return 201 with the storage key.
    throw new NotImplementedException('screenshots.upload not yet implemented');
  }

  redact(_id: string, _dto: RedactScreenshot, _user: SessionUser): Promise<Screenshot> {
    // TODO(scaffold): mark REDACTED with reason; owner-only; never silently remove.
    throw new NotImplementedException('screenshots.redact not yet implemented');
  }
}

// Presigned `url` is intentionally absent until MinioService is wired into upload.
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
