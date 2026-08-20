import { ConflictException, Injectable } from '@nestjs/common';
import type { ShotStatus } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * A same-PK upload from a different user, or onto an already-REDACTED row, must not silently
 * repoint storage/reset status (cross-user tampering + un-redaction). Mirrors the 409 pattern
 * from time-entries.repository.ts's runningConflict().
 */
function uploadConflict(): ConflictException {
  return new ConflictException({
    type: 'https://timetrack.internal/errors/conflict',
    title: 'Screenshot id already belongs to another user or is redacted',
    status: 409,
  });
}

export interface ScreenshotRow {
  id: string;
  userId: string;
  timestamp: Date;
  storageKey: string;
  thumbnailKey: string | null;
  blurred: boolean;
  status: ShotStatus;
  redactedReason: string | null;
  captureGroupId: string | null;
  displayIndex: number | null;
  displayCount: number | null;
}

@Injectable()
export class ScreenshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ordered newest-first, then by display position, so the displays captured in one tick arrive
   * adjacent and in a stable order — the grouping downstream relies on nothing more than that.
   * `displayIndex` is null on pre-multi-display rows; those are groups of one, so their relative
   * order is immaterial.
   */
  listByUser(userId: string, from: Date, to: Date): Promise<ScreenshotRow[]> {
    return this.prisma.screenshot.findMany({
      where: { userId, timestamp: { gte: from, lte: to } },
      orderBy: [{ timestamp: 'desc' }, { displayIndex: 'asc' }],
      select: ScreenshotsRepository.SELECT,
    });
  }

  /** The ONE select list. Reads used to carry a second, inline copy; a field added to one and
   * not the other silently disappeared from list responses. */
  private static readonly SELECT = {
    id: true,
    userId: true,
    timestamp: true,
    storageKey: true,
    thumbnailKey: true,
    blurred: true,
    status: true,
    redactedReason: true,
    captureGroupId: true,
    displayIndex: true,
    displayCount: true,
  } as const;

  /**
   * Upsert on the composite PK [id, timestamp]. A retried upload (client deletes local only
   * after a confirmed 201) re-sends the same id+timestamp and takes the update branch, which
   * resets the row to PENDING so the worker re-derives against the just-overwritten raw object.
   *
   * Guarded atomically: if a row already exists at this PK, it must belong to the SAME userId
   * and must NOT be REDACTED, or this throws a 409 rather than repointing another user's row
   * or resurrecting a redacted one.
   */
  create(
    meta: {
      id: string;
      timestamp: string;
      captureGroupId?: string | undefined;
      displayIndex?: number | undefined;
      displayCount?: number | undefined;
    },
    userId: string,
    storageKey: string,
  ): Promise<ScreenshotRow> {
    const timestamp = new Date(meta.timestamp);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.screenshot.findUnique({
        where: { id_timestamp: { id: meta.id, timestamp } },
        select: { userId: true, status: true },
      });
      if (existing && (existing.userId !== userId || existing.status === 'REDACTED')) {
        throw uploadConflict();
      }
      return tx.screenshot.upsert({
        where: { id_timestamp: { id: meta.id, timestamp } },
        create: {
          id: meta.id,
          userId,
          timestamp,
          storageKey,
          status: 'PENDING',
          blurred: false,
          captureGroupId: meta.captureGroupId ?? null,
          displayIndex: meta.displayIndex ?? null,
          displayCount: meta.displayCount ?? null,
        },
        // A retry re-sends the same grouping fields, so re-writing them is a no-op; leaving them
        // out would instead strand a row outside its group if the first attempt raced a rollback.
        update: {
          storageKey,
          status: 'PENDING',
          blurred: false,
          thumbnailKey: null,
          captureGroupId: meta.captureGroupId ?? null,
          displayIndex: meta.displayIndex ?? null,
          displayCount: meta.displayCount ?? null,
        },
        select: ScreenshotsRepository.SELECT,
      });
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
