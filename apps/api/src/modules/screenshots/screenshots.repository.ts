import { Injectable } from '@nestjs/common';
import type { ShotStatus } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface ScreenshotRow {
  id: string;
  userId: string;
  timestamp: Date;
  storageKey: string;
  thumbnailKey: string | null;
  blurred: boolean;
  status: ShotStatus;
  redactedReason: string | null;
}

@Injectable()
export class ScreenshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByUser(userId: string, from: Date, to: Date): Promise<ScreenshotRow[]> {
    return this.prisma.screenshot.findMany({
      where: { userId, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        userId: true,
        timestamp: true,
        storageKey: true,
        thumbnailKey: true,
        blurred: true,
        status: true,
        redactedReason: true,
      },
    });
  }

  // TODO(scaffold): create(row) on multipart upload → status PENDING (PRD §7.4).
  // TODO(scaffold): redact(id, userId, reason) → status REDACTED, set redactedReason.
  //                 An employee may redact only their OWN screenshot (PRD §6.2).
}
