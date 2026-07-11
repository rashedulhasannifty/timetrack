import { Injectable } from '@nestjs/common';
import type { CreateTimeEntry, ListTimeEntriesQuery, TimeEntry } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * CLAUDE.md §3 — Prisma lives HERE and nowhere else in apps/api.
 * This seam is what lets service tests run without a DB while integration tests
 * hit a real Postgres through the same interface.
 */
@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(dto: CreateTimeEntry, userId: string): Promise<TimeEntry> {
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
      select: {
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
      },
    });
    return serialize(row);
  }

  async list(query: ListTimeEntriesQuery & { userId: string }): Promise<TimeEntry[]> {
    const rows = await this.prisma.timeEntry.findMany({
      where: {
        userId: query.userId,
        startTime: { gte: new Date(query.from), lte: new Date(query.to) },
        ...(query.projectId ? { projectId: query.projectId } : {}),
      },
      orderBy: { startTime: 'asc' },
      select: {
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
      },
    });
    return rows.map(serialize);
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
