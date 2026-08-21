import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type {
  CreateTimeEntry,
  ListTimeEntriesQuery,
  TimeEntry,
  UpdateTimeEntry,
} from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { TRACKING_FRESHNESS_SECONDS } from './time-entries.tokens.js';

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
 * 409 here (we catch P2002 in the repository as the invites repo does, and translate straight
 * to a 409 here) so Prisma text never reaches the client.
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
  // PrismaService is named EXPLICITLY rather than left to the emitted type metadata: once any
  // parameter carries an @Inject, Nest resolves the whole list from metadata that vitest's
  // transform drops, and the class then fails to construct with "argument at index [0]".
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number,
  ) {}

  async upsert(dto: CreateTimeEntry, userId: string): Promise<TimeEntry> {
    try {
      const now = new Date();
      // Opening a span takes over from an abandoned one; a CLOSED upload is the hot batch path
      // and skips the transaction entirely.
      const row = dto.endTime
        ? await this.upsertEntry(this.prisma, dto, userId, now)
        : await this.prisma.$transaction(async (tx) => {
            await this.retireStaleRunning(tx, userId, dto.id, now);
            return this.upsertEntry(tx, dto, userId, now);
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

  /**
   * Close any of this user's open entries that have stopped proving they are alive, so a new
   * session can open.
   *
   * Without this, ONE abandoned entry blocks live tracking for that person FOREVER: the partial
   * unique index allows a single open entry, so every later `publish` returns 409 and the clock
   * silently stops reaching the server. A client can be abandoned in ordinary ways — a crash, a
   * force-quit, a wiped machine, a local span discarded without the server row being closed —
   * and the staleness clamp only bounds the DURATION such a row reports, never unblocks the
   * index. This was seen in the wild: a two-day-old open row with no heartbeat rejecting every
   * live entry while activity samples kept flowing, so the dashboard showed the person as
   * "tracking now" with their tracked time frozen.
   *
   * Staleness uses the SAME evidence-of-life the read path clamps with: `heartbeatAt`, falling
   * back to `startTime` for a row that never heartbeated at all. An entry that IS still fresh is
   * a genuine concurrent session — that keeps its 409 rather than being stolen.
   *
   * The close lands on `COALESCE(heartbeatAt, startTime)`: the last instant there was evidence
   * the clock was running. Never `now()`, which would invent hours nobody worked, and never the
   * clamp's grace window, which is a display allowance rather than a recorded fact.
   */
  private async retireStaleRunning(
    tx: Prisma.TransactionClient,
    userId: string,
    exceptId: string,
    now: Date,
  ): Promise<void> {
    const staleBefore = new Date(now.getTime() - this.trackingFreshnessSeconds * 1000);
    await tx.$executeRaw`
      UPDATE time_entries
      SET "endTime" = COALESCE("heartbeatAt", "startTime")
      WHERE "userId" = ${userId}
        AND "endTime" IS NULL
        AND id <> ${exceptId}
        AND COALESCE("heartbeatAt", "startTime") < ${staleBefore}
    `;
  }

  private async upsertEntry(
    client: Prisma.TransactionClient | PrismaService,
    dto: CreateTimeEntry,
    userId: string,
    now: Date,
  ) {
    return client.timeEntry.upsert({
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
        heartbeatAt: now,
      },
      update: {
        // The close is MONOTONE: an open payload arriving after the close (a retry, or a
        // heartbeat queued behind it) must NOT null a stored endTime and re-open the entry.
        // The same reasoning covers `note`: a heartbeat re-POST that omits it must not erase
        // a note set earlier. Corrections go through the audited PATCH path, not here.
        ...(dto.endTime ? { endTime: new Date(dto.endTime) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        heartbeatAt: now,
      },
      select: TIME_ENTRY_SELECT,
    });
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
    // A zero-duration row is a discarded recovery span (spec §4.4) — never shown. Filtered
    // in JS, not the `where`: a Prisma field-reference predicate (`NOT: { endTime: { equals:
    // fields.startTime } }`) evaluates to UNKNOWN under SQL's three-valued logic when
    // endTime IS NULL, which would silently drop every OPEN entry too. `list` is un-paginated
    // (plain findMany), so filtering after the query changes no semantics.
    return rows.filter((r) => r.endTime === null || r.endTime > r.startTime).map(serialize);
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

  /**
   * PATCH edit: write only the fields in `after`, stamp editedBy/editedAt, and audit the
   * before/after diff in ONE transaction (CLAUDE.md §4). Distinct from `upsert`'s close
   * path, which is normal operation and is NOT audited/stamped.
   */
  async update(
    id: string,
    after: UpdateTimeEntry,
    before: UpdateTimeEntry,
    actorId: string,
  ): Promise<TimeEntry> {
    const data: Prisma.TimeEntryUncheckedUpdateInput = {
      editedById: actorId,
      editedAt: new Date(),
    };
    if ('projectId' in after) data.projectId = after.projectId as string | null;
    if ('taskId' in after) data.taskId = after.taskId as string | null;
    if ('source' in after) data.source = after.source as 'MANUAL' | 'AUTO';
    if ('note' in after) data.note = after.note ?? null;
    if ('startTime' in after) data.startTime = new Date(after.startTime as string);
    if ('endTime' in after) data.endTime = after.endTime ? new Date(after.endTime) : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.timeEntry.update({ where: { id }, data, select: TIME_ENTRY_SELECT });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'time_entry.edit',
            targetType: 'time_entry',
            targetId: id,
            diff: { before, after },
          },
        });
        return serialize(row);
      });
    } catch (e) {
      // Reopening an entry (endTime -> null) can collide with another open one.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw runningConflict();
      }
      throw e;
    }
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
