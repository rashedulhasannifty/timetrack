import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { CreateTimeEntry, ListTimeEntriesQuery, TimeEntry } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// Never select `*` back to the client — the single field list every read reuses.
const TIME_ENTRY_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  taskId: true,
  startTime: true,
  endTime: true,
  source: true,
  note: true,
  editedById: true,
  editedAt: true,
} as const;

/**
 * The partial unique index `time_entries_one_running_per_user` guarantees a user has at
 * most one open entry; a create that would open a second one raises P2002. Surface it as a
 * 409 here (invites precedent) so Prisma text never reaches the client.
 */
function runningConflict(): ConflictException {
  return new ConflictException({
    type: 'https://timetrack.internal/errors/conflict',
    title: 'A running time entry already exists for this user',
    status: 409,
  });
}

/**
 * CLAUDE.md §3 — Prisma lives HERE and nowhere else in apps/api.
 */
@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(dto: CreateTimeEntry, userId: string): Promise<TimeEntry> {
    try {
      const row = await this.prisma.timeEntry.upsert({
        where: { id: dto.id },
        create: {
          id: dto.id,
          userId,
          projectId: dto.projectId,
          taskId: dto.taskId,
          source: dto.source,
          note: dto.note ?? null,
          startTime: new Date(dto.startTime),
          endTime: dto.endTime ? new Date(dto.endTime) : null,
        },
        update: { endTime: dto.endTime ? new Date(dto.endTime) : null, note: dto.note ?? null },
        select: TIME_ENTRY_SELECT,
      });
      return serialize(row);
    } catch (e) {
      // A second OPEN entry for this user violates the partial unique index. A retried
      // same-id batch takes the UPDATE branch and never trips it (idempotent, PRD §7.5).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw runningConflict();
      }
      throw e;
    }
  }

  async list(query: ListTimeEntriesQuery & { userId: string }): Promise<TimeEntry[]> {
    const rows = await this.prisma.timeEntry.findMany({
      where: {
        userId: query.userId,
        startTime: { gte: new Date(query.from), lte: new Date(query.to) },
        ...(query.projectId ? { projectId: query.projectId } : {}),
      },
      orderBy: { startTime: 'asc' },
      select: TIME_ENTRY_SELECT,
    });
    return rows.map(serialize);
  }

  /** The running entry (endTime IS NULL) for a user, or null. Backs the overview (1.6). */
  async findActiveByUser(userId: string): Promise<TimeEntry | null> {
    const row = await this.prisma.timeEntry.findFirst({
      where: { userId, endTime: null },
      select: TIME_ENTRY_SELECT,
    });
    return row ? serialize(row) : null;
  }

  /** Full serialized entry by id (its userId drives edit authorization), or null. */
  async findForEdit(id: string): Promise<TimeEntry | null> {
    const row = await this.prisma.timeEntry.findUnique({
      where: { id },
      select: TIME_ENTRY_SELECT,
    });
    return row ? serialize(row) : null;
  }
}

// Never select `*` back to the client — always `select` the fields you need.
function serialize(row: {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  startTime: Date;
  endTime: Date | null;
  source: 'MANUAL' | 'AUTO';
  note: string | null;
  editedById: string | null;
  editedAt: Date | null;
}): TimeEntry {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    taskId: row.taskId,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime?.toISOString() ?? null,
    source: row.source,
    note: row.note ?? undefined,
    editedById: row.editedById,
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}
