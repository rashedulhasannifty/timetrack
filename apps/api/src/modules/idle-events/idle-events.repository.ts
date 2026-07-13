import { Injectable } from '@nestjs/common';
import type { IdleEvent, IdleEventResult, ResolvedAction } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// Never select `*` back to the client — echo only the event's identity + resolution.
const IDLE_EVENT_SELECT = { id: true, resolvedAction: true } as const;

/**
 * CLAUDE.md §3 — Prisma lives HERE and nowhere else in apps/api. Upsert on the
 * client-minted UUIDv7 (PRD §7.5): a retried offline drain is a no-op, not a duplicate.
 * The event is an audit/analytics row — no reconciliation of overlapping time entries.
 */
@Injectable()
export class IdleEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(event: IdleEvent, userId: string): Promise<IdleEventResult> {
    const row = await this.prisma.idleEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        userId,
        startTime: new Date(event.startTime),
        endTime: new Date(event.endTime),
        resolvedAction: event.resolvedAction,
      },
      update: {
        endTime: new Date(event.endTime),
        resolvedAction: event.resolvedAction,
      },
      select: IDLE_EVENT_SELECT,
    });
    // resolvedAction is stored as a plain String column; it was written from a
    // Zod-validated payload, so narrowing back to the union is safe.
    return { id: row.id, resolvedAction: row.resolvedAction as ResolvedAction };
  }
}
