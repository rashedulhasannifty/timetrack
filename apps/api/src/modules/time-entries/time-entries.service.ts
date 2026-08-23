import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreateTimeEntry,
  ListTimeEntriesQuery,
  TimeEntry,
  UpdateTimeEntry,
} from '@timetrack/contracts';
import { TimeEntriesRepository } from './time-entries.repository.js';
import { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

// The fields UpdateTimeEntrySchema permits — the only ones an edit may touch or diff.
const EDITABLE_KEYS = ['projectId', 'taskId', 'startTime', 'endTime', 'source', 'note'] as const;

/**
 * CLAUDE.md §3 — services hold business logic. No Prisma; go through the repository.
 * List/upsert authorization is enforced by `@ResourceScope` on the controller. Edit is
 * authorized here (the target user is on the row, not in the request) via the shared
 * ResourceAccessService — the ONE place the self/team/admin rule lives.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly repo: TimeEntriesRepository,
    private readonly access: ResourceAccessService,
  ) {}

  upsert(dto: CreateTimeEntry, user: SessionUser): Promise<TimeEntry> {
    // A time entry is always attributed to the authenticated user (no cross-user writes).
    return this.repo.upsert(dto, user.id);
  }

  list(query: ListTimeEntriesQuery, user: SessionUser): Promise<TimeEntry[]> {
    const targetId = query.userId ?? user.id;
    return this.repo.list({ ...query, userId: targetId });
  }

  /** The running entry for a user (backs the overview in Slice 1.6). */
  findActive(userId: string): Promise<TimeEntry | null> {
    return this.repo.findActiveByUser(userId);
  }

  async edit(id: string, dto: UpdateTimeEntry, actor: SessionUser): Promise<TimeEntry> {
    const current = await this.repo.findForEdit(id);
    if (!current) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'Time entry not found',
        status: 404,
      });
    }
    // owner / manager-of-team / admin — the one rule, checked against the entry's owner.
    await this.access.assertCanAccessUser(actor, current.userId);

    const { before, after } = diffChangedFields(current, dto);
    if (Object.keys(after).length === 0) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Edit changes no fields',
        status: 422,
      });
    }
    await this.assertMergedEntryIsSane(current, dto, id);
    return this.repo.update(id, after, before, actor.id);
  }
  /**
   * A patch carries only the fields it changes, so the schema can only check a pair it is
   * given BOTH halves of. These are the checks that need the STORED row: moving one edge past
   * a stored one, and colliding with a different entry.
   *
   * Both are edit-path only. The client's offline sync upserts without them on purpose — a
   * rejection is permanent to the uploader, so refusing there would drop recorded time.
   */
  private async assertMergedEntryIsSane(
    current: TimeEntry,
    dto: UpdateTimeEntry,
    id: string,
  ): Promise<void> {
    const startTime = dto.startTime ?? current.startTime;
    const endTime = 'endTime' in dto ? (dto.endTime ?? null) : current.endTime;
    if (endTime !== null && Date.parse(endTime) < Date.parse(startTime)) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'endTime must not be before startTime',
        status: 422,
      });
    }
    // An entry left OPEN is not overlap-checked here: the one-running-per-user partial index
    // is what governs a second open row, and 'no end yet' has no extent to compare against.
    if (endTime === null) return;
    const overlaps = await this.repo.hasOverlap(
      current.userId,
      id,
      new Date(startTime),
      new Date(endTime),
    );
    if (overlaps) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Entry overlaps another entry for this user',
        status: 422,
      });
    }
  }
}

/**
 * Build the before/after audit diff from only the fields the patch actually changes.
 * `after` doubles as the write payload; an empty `after` means a no-op edit (→ 422).
 * `undefined` (absent value) normalizes to `null` for JSON storage.
 */
function diffChangedFields(
  current: TimeEntry,
  dto: UpdateTimeEntry,
): { before: UpdateTimeEntry; after: UpdateTimeEntry } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in dto)) continue;
    const next = dto[key];
    const prev = current[key];
    if (next !== prev) {
      before[key] = prev ?? null;
      after[key] = next ?? null;
    }
  }
  return { before, after };
}
