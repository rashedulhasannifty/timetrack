import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreateManualTimeEntry,
  CreateTimeEntry,
  ListTimeEntriesQuery,
  TimeEntry,
  UpdateTimeEntry,
} from '@timetrack/contracts';
import { TimeEntriesRepository } from './time-entries.repository.js';
import { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

/** Clock skew between a browser and the server that must not read as "time in the future". */
const FUTURE_TOLERANCE_MS = 60_000;

// The fields UpdateTimeEntrySchema permits — the only ones an edit may touch or diff.
const EDITABLE_KEYS = ['projectId', 'taskId', 'startTime', 'endTime', 'source', 'note'] as const;

export type SubprojectCandidates = {
  defaultId: string | null;
  taskSubprojectId: string | null;
  requestedBelongs: boolean;
};

/**
 * Which subproject an entry belongs to (spec §2 "Subproject resolution"):
 *   1. no project → none;
 *   2. an explicit subproject of that project → it. One from another project is a 422 on the
 *      dashboard paths ('strict') but ignored on the sync path ('lenient'): a 4xx is permanent to
 *      the uploader and would drop recorded time;
 *   3. the task's subproject, when the task is in that project;
 *   4. the project's default. A project that does not exist has no default → none.
 */
export function pickSubproject(
  input: {
    projectId: string | null;
    taskId: string | null;
    subprojectId?: string | null | undefined;
  },
  candidates: SubprojectCandidates | null,
  mode: 'strict' | 'lenient',
): string | null {
  if (input.projectId === null || candidates === null) return null;
  if (input.subprojectId) {
    if (candidates.requestedBelongs) return input.subprojectId;
    if (mode === 'strict') {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Subproject does not belong to the project',
        status: 422,
      });
    }
  }
  return candidates.taskSubprojectId ?? candidates.defaultId;
}

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

  async upsert(dto: CreateTimeEntry, user: SessionUser): Promise<TimeEntry> {
    const subprojectId = await this.resolveSubproject(dto, 'lenient');
    // A time entry is always attributed to the authenticated user (no cross-user writes).
    return this.repo.upsert(dto, user.id, subprojectId);
  }

  private async resolveSubproject(
    input: {
      projectId: string | null;
      taskId: string | null;
      subprojectId?: string | null | undefined;
    },
    mode: 'strict' | 'lenient',
  ): Promise<string | null> {
    // No lookup for an entry with no project — that is most auto-tracked heartbeats.
    if (input.projectId === null) return null;
    const candidates = await this.repo.subprojectCandidates(
      input.projectId,
      input.taskId,
      input.subprojectId ?? null,
    );
    return pickSubproject(input, candidates, mode);
  }

  /**
   * Create one hand-entered span (the dashboard's "add time"). Everything the offline sync
   * path deliberately skips applies here, because a person is present to be told:
   *
   *   - the span may not OVERLAP another of that user's entries. Sync tolerates overlap on
   *     purpose (a rejection is permanent to the uploader and would drop recorded time), but a
   *     form submission has a human who can move it;
   *   - it may not END in the future. A minute of tolerance absorbs clock skew between the
   *     browser and the server without letting someone bank tomorrow.
   */
  async createManual(dto: CreateManualTimeEntry, actor: SessionUser): Promise<TimeEntry> {
    const targetUserId = dto.userId ?? actor.id;
    // Filing time on someone else's record is the same authority as editing it: self,
    // manager-of-their-team, or admin. One rule, one place.
    if (targetUserId !== actor.id) await this.access.assertCanAccessUser(actor, targetUserId);

    if (Date.parse(dto.endTime) > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Entry ends in the future',
        status: 422,
      });
    }

    const overlaps = await this.repo.hasOverlap(
      targetUserId,
      dto.id,
      new Date(dto.startTime),
      new Date(dto.endTime),
    );
    if (overlaps) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Entry overlaps another entry for this user',
        status: 422,
      });
    }

    const subprojectId = await this.resolveSubproject(dto, 'strict');
    return this.repo.createManual(dto, targetUserId, actor.id, subprojectId);
  }

  /**
   * Delete one entry. Authorized against the row's OWNER, like edit — the request carries only
   * an id. The repository writes the AuditLog row in the same transaction, so a delete is never
   * silent (CLAUDE.md §4).
   */
  async remove(id: string, actor: SessionUser): Promise<void> {
    const current = await this.repo.findForEdit(id);
    if (!current) {
      throw new NotFoundException({
        type: 'https://timetrack.internal/errors/not-found',
        title: 'Time entry not found',
        status: 404,
      });
    }
    await this.access.assertCanAccessUser(actor, current.userId);
    await this.repo.remove(id, actor.id);
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
    // The subproject is derived, not free-form: re-resolve whenever the assignment is touched.
    // An explicit subprojectId in the patch is validated (strict); a project/task change without
    // one re-derives it (task's subproject, else the project's default).
    if ('projectId' in dto || 'taskId' in dto || 'subprojectId' in dto) {
      const projectId = 'projectId' in dto ? (dto.projectId ?? null) : current.projectId;
      const taskId = 'taskId' in dto ? (dto.taskId ?? null) : current.taskId;
      const requested =
        'subprojectId' in dto
          ? (dto.subprojectId ?? null)
          : 'projectId' in dto || 'taskId' in dto
            ? null
            : current.subprojectId;
      const resolved = await this.resolveSubproject(
        { projectId, taskId, subprojectId: requested },
        'strict',
      );
      if (resolved !== current.subprojectId) {
        before.subprojectId = current.subprojectId;
        after.subprojectId = resolved;
      }
    }
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
