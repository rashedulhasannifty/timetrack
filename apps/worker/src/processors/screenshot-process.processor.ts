import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { TeamSettingsSchema } from '@timetrack/contracts';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { WorkerS3 } from '../infra/s3.provider.js';
import { deriveScreenshot } from './screenshot-derive.js';

interface DeriveJob {
  id: string;
  timestamp: string;
}

/**
 * PRD §7.4 — download the PENDING raw, derive a thumbnail (+ team blur policy), write derivatives,
 * mark READY. A slow image job must never touch API latency — hence a separate worker.
 */
@Injectable()
@Processor('screenshot-process')
export class ScreenshotProcessProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly s3: WorkerS3,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<DeriveJob>): Promise<void> {
    const { id, timestamp } = job.data;
    const row = await this.prisma.screenshot.findUnique({
      where: { id_timestamp: { id, timestamp: new Date(timestamp) } },
      select: { id: true, userId: true, storageKey: true, status: true },
    });
    if (!row || row.status !== 'PENDING') {
      this.logger.log(
        { jobId: job.id, id, status: row?.status ?? 'MISSING' },
        'screenshot-process skipped',
      );
      return;
    }

    const team = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { team: { select: { settings: true } } },
    });
    const blur = TeamSettingsSchema.parse(team?.team.settings ?? {}).screenshotBlur;

    const raw = await this.s3.getObject(row.storageKey);
    const derived = await deriveScreenshot(raw, blur);

    const thumbnailKey = `thumb/${row.userId}/${id}`;
    await this.s3.putObject(thumbnailKey, derived.thumbnail, 'image/jpeg');
    if (derived.rawReplacement)
      await this.s3.putObject(row.storageKey, derived.rawReplacement, 'image/png');
    if (derived.deleteRaw) await this.s3.deleteObject(row.storageKey);

    // Guard against a redact that committed between the findUnique above and this write —
    // only flip PENDING -> READY. If the row moved on (e.g. REDACTED), this must not
    // resurrect it; best-effort clean up the thumbnail we just wrote and skip.
    const result = await this.prisma.screenshot.updateMany({
      where: { id, timestamp: new Date(timestamp), status: 'PENDING' },
      data: {
        thumbnailKey,
        blurred: derived.blurred,
        status: 'READY',
        ...(derived.deleteRaw ? { storageKey: '' } : {}),
      },
    });
    if (result.count === 0) {
      try {
        await this.s3.deleteObject(thumbnailKey);
      } catch {
        // best-effort cleanup only — the row is no longer PENDING either way
      }
      this.logger.log(
        { jobId: job.id, id, status: 'skipped-not-pending' },
        'screenshot-process skipped-not-pending',
      );
      return;
    }
    this.logger.log(
      { jobId: job.id, id, userId: row.userId, status: 'READY' },
      'screenshot-process done',
    );
  }
}
