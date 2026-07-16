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

  private static readonly SELECT = {
    id: true,
    userId: true,
    timestamp: true,
    storageKey: true,
    thumbnailKey: true,
    blurred: true,
    status: true,
    redactedReason: true,
  } as const;

  /**
   * Upsert on the composite PK [id, timestamp]. A retried upload (client deletes local only
   * after a confirmed 201) re-sends the same id+timestamp and takes the update branch, which
   * resets the row to PENDING so the worker re-derives against the just-overwritten raw object.
   */
  create(
    meta: { id: string; timestamp: string },
    userId: string,
    storageKey: string,
  ): Promise<ScreenshotRow> {
    const timestamp = new Date(meta.timestamp);
    return this.prisma.screenshot.upsert({
      where: { id_timestamp: { id: meta.id, timestamp } },
      create: { id: meta.id, userId, timestamp, storageKey, status: 'PENDING', blurred: false },
      update: { storageKey, status: 'PENDING', blurred: false, thumbnailKey: null },
      select: ScreenshotsRepository.SELECT,
    });
  }

  /** First row for `id` — redact carries only `id`, but the PK needs `timestamp` too. */
  findById(id: string): Promise<ScreenshotRow | null> {
    return this.prisma.screenshot.findFirst({
      where: { id },
      select: ScreenshotsRepository.SELECT,
    });
  }

  /** Redact: set REDACTED + reason and audit it in ONE transaction (CLAUDE.md §4). */
  markRedacted(
    id: string,
    timestamp: Date,
    reason: string,
    actorId: string,
  ): Promise<ScreenshotRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.screenshot.update({
        where: { id_timestamp: { id, timestamp } },
        data: { status: 'REDACTED', redactedReason: reason },
        select: ScreenshotsRepository.SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'screenshot.redact',
          targetType: 'screenshot',
          targetId: id,
          diff: { reason },
        },
      });
      return row;
    });
  }

  /** Hard-delete by PK — cleanup for a truncated upload only (never used for user-visible deletes). */
  async deleteByPk(id: string, timestamp: Date): Promise<void> {
    await this.prisma.screenshot.delete({ where: { id_timestamp: { id, timestamp } } });
  }
}
