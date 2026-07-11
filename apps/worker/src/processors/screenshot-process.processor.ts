import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { WorkerPrisma } from '../infra/prisma.provider.js';

/**
 * PRD §7.4 — after the API stores a raw screenshot (status PENDING), this job generates
 * a thumbnail, applies blur if the team policy demands it (via `sharp`), and marks the
 * row READY. A slow thumbnail job must never touch API latency — hence a separate worker.
 */
@Injectable()
@Processor('screenshot-process')
export class ScreenshotProcessProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  process(job: Job): Promise<void> {
    // TODO(scaffold): fetch the PENDING row, download from MinIO, sharp().resize() for a
    // thumbnail + optional blur per TeamSettings, upload derivatives, mark READY.
    void this.prisma;
    this.logger.log({ jobId: job.id }, 'screenshot-process received');
    return Promise.resolve();
  }
}
