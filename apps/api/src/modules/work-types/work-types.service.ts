import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_SUBPROJECT_NAME,
  nameKey,
  normalizeName,
  type BulkCreateWorkTypes,
  type BulkCreateWorkTypesResult,
  type ReconcileCounts,
  type SetTeamWorkTypes,
  type TeamWorkTypes,
  type UpdateWorkType,
  type WorkType,
  type WorkTypeWithTeams,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { planNameImport } from '../../common/name-import.js';
import { WorkTypesRepository } from './work-types.repository.js';

const RESERVED_KEY = nameKey(DEFAULT_SUBPROJECT_NAME);

/**
 * The org-wide work-type catalog and each team's selection (spec §6). ADMIN-only at the
 * controller; there is no per-resource rule to add here because these are org-wide objects.
 */
@Injectable()
export class WorkTypesService {
  constructor(@Inject(WorkTypesRepository) private readonly repo: WorkTypesRepository) {}

  list(): Promise<WorkTypeWithTeams[]> {
    return this.repo.listWithTeams();
  }

  async bulkCreate(
    dto: BulkCreateWorkTypes,
    actor: SessionUser,
  ): Promise<BulkCreateWorkTypesResult> {
    const taken = new Map<string, string>([[RESERVED_KEY, 'Reserved name']]);
    for (const w of await this.repo.listAll()) taken.set(nameKey(w.name), 'Already in the catalog');
    const { accepted, skipped } = planNameImport(dto.names, taken);
    const created = accepted.length === 0 ? [] : await this.repo.createMany(accepted, actor.id);
    return { created, skipped };
  }

  async update(id: string, dto: UpdateWorkType, actor: SessionUser): Promise<WorkType> {
    // exactOptionalPropertyTypes: only the keys the caller actually sent.
    const patch: { name?: string; archived?: boolean } = {};
    if (dto.name !== undefined) {
      const name = normalizeName(dto.name);
      if (name.length === 0) throw this.unprocessable('Enter a name');
      const key = nameKey(name);
      if (key === RESERVED_KEY) throw this.conflict('“General” is reserved');
      const clash = (await this.repo.listAll()).find((w) => w.id !== id && nameKey(w.name) === key);
      if (clash) throw this.conflict('A work type with this name already exists');
      patch.name = name;
    }
    if (dto.archived !== undefined) patch.archived = dto.archived;
    const updated = await this.repo.update(id, patch, actor.id);
    if (!updated) throw this.notFound('Work type not found');
    return updated;
  }

  async setTeamSelection(
    teamId: string,
    dto: SetTeamWorkTypes,
    actor: SessionUser,
  ): Promise<TeamWorkTypes> {
    if (!(await this.repo.teamExists(teamId))) throw this.notFound('Team not found');
    const ids = [...new Set(dto.workTypeIds)];
    const found = await this.repo.findByIds(ids);
    if (found.length !== ids.length) throw this.notFound('Work type not found');
    if (found.some((w) => w.archived)) {
      throw this.unprocessable('Archived work types cannot be selected');
    }
    return this.repo.setTeamSelection(teamId, ids, actor.id);
  }

  resync(actor: SessionUser): Promise<ReconcileCounts> {
    return this.repo.resync(actor.id);
  }

  private conflict(title: string): ConflictException {
    return new ConflictException({
      type: 'https://timetrack.internal/errors/conflict',
      title,
      status: 409,
    });
  }

  private notFound(title: string): NotFoundException {
    return new NotFoundException({
      type: 'https://timetrack.internal/errors/not-found',
      title,
      status: 404,
    });
  }

  private unprocessable(title: string): UnprocessableEntityException {
    return new UnprocessableEntityException({
      type: 'https://timetrack.internal/errors/unprocessable',
      title,
      status: 422,
    });
  }
}
