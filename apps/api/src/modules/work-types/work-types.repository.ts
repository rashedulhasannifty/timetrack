import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type {
  ReconcileCounts,
  TeamWorkTypes,
  WorkType,
  WorkTypeWithTeams,
} from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  groupRenames,
  planReconcile,
  type DesiredWorkType,
  type ReconcileAudit,
} from './work-types.reconcile.js';

/**
 * Transaction options for EVERY transaction that reconciles. Prisma's interactive transaction
 * defaults to 5s, which a whole-org re-sync (≈100 clients × 12 work types) or a 500-client
 * import can exceed — it then P2028-rolls-back while every small-seed test passes. A one-project
 * create or team move needs it too: it queues on the reconcile lock behind such a re-sync.
 */
export const RECONCILE_TX = { timeout: 60_000, maxWait: 10_000 } as const;

/**
 * Serializes every reconciling transaction org-wide (transaction-scoped advisory lock; released
 * at commit/rollback). Reconcile reads the selection, the catalog names and the subprojects in
 * separate READ COMMITTED statements, so two overlapping reconciles could each act on a view the
 * other was changing: a rename racing a column save left the save's rows under the old name, and
 * a re-sync racing a save archived the rows the save had just made.
 *
 * Call it as the FIRST statement of the transaction: the triggers read state (the current
 * selection, the work type before its update) that must not change before they reconcile.
 * The key is a literal, not a parameter, so it binds as bigint.
 */
export async function lockReconcile(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7311947202601)`;
}

export const CONCURRENT_CHANGE = 'The catalog changed while saving. Try again.';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * What a reconciling transaction raises when another write won a race: a unique violation
 * (P2002), or a deadlock / serialization failure (P2034 — the pg adapter's mapping of 40P01 and
 * 40001). Either way the whole trigger rolled back, so the caller gets a safe "try again" 409.
 */
export function isConcurrencyConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2034')
  );
}

const WORK_TYPE_NAME_INDEX = 'work_types_name_ci_unique';

/**
 * A P2002 on the catalog's case-insensitive name index specifically. The pg adapter names the
 * index in `meta.driverAdapterError.cause.constraint.index`; the message is the fallback.
 */
function isNameIndexViolation(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const meta = e.meta as
    { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined;
  return (
    meta?.driverAdapterError?.cause?.constraint?.index === WORK_TYPE_NAME_INDEX ||
    e.message.includes(WORK_TYPE_NAME_INDEX)
  );
}

export function catalogConflict(title: string): ConflictException {
  return new ConflictException({
    type: 'https://timetrack.internal/errors/conflict',
    title,
    status: 409,
  });
}

const WORK_TYPE_SELECT = { id: true, name: true, archived: true } as const;

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class WorkTypesRepository {
  // Explicit token: see projects.service.ts — vitest drops design:paramtypes.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The single sync rule (spec §5). Runs inside the CALLER's transaction so a project create,
   * bulk import, team move, selection save or catalog edit commits together with its subprojects.
   * The caller must have taken `lockReconcile(tx)` as its transaction's first statement.
   * Writes exactly one `work_type.reconcile` audit row per call, even when nothing changed.
   */
  async reconcile(
    tx: Prisma.TransactionClient,
    projectIds: readonly string[],
    audit: ReconcileAudit,
  ): Promise<ReconcileCounts> {
    const ids = [...new Set(projectIds)];
    const projects =
      ids.length === 0
        ? []
        : await tx.project.findMany({
            where: { id: { in: ids } },
            select: { id: true, teamId: true },
          });

    const teamIds = [...new Set(projects.map((p) => p.teamId))];
    const selections =
      teamIds.length === 0
        ? []
        : await tx.teamWorkType.findMany({
            where: { teamId: { in: teamIds }, workType: { archived: false } },
            select: { teamId: true, workType: { select: { id: true, name: true } } },
          });
    const desiredByTeam = new Map<string, DesiredWorkType[]>();
    for (const s of selections) {
      const list = desiredByTeam.get(s.teamId);
      if (list) list.push(s.workType);
      else desiredByTeam.set(s.teamId, [s.workType]);
    }

    const subprojects =
      ids.length === 0
        ? []
        : await tx.subproject.findMany({
            where: { projectId: { in: ids } },
            select: {
              id: true,
              projectId: true,
              name: true,
              archived: true,
              isDefault: true,
              workTypeId: true,
            },
          });

    const plan = planReconcile(projects, desiredByTeam, subprojects);

    // skipDuplicates = ON CONFLICT DO NOTHING (no target), which also covers the partial unique
    // index: a concurrent reconcile that got there first is not an error (plan ruling R9).
    const created =
      plan.create.length === 0
        ? 0
        : (await tx.subproject.createMany({ data: plan.create, skipDuplicates: true })).count;
    for (const l of plan.link) {
      await tx.subproject.update({
        where: { id: l.id },
        data: { workTypeId: l.workTypeId, name: l.name, archived: false },
        select: { id: true },
      });
    }
    if (plan.restore.length > 0) {
      await tx.subproject.updateMany({
        where: { id: { in: plan.restore } },
        data: { archived: false },
      });
    }
    for (const [name, rowIds] of groupRenames(plan.rename)) {
      await tx.subproject.updateMany({ where: { id: { in: rowIds } }, data: { name } });
    }
    if (plan.archive.length > 0) {
      await tx.subproject.updateMany({
        where: { id: { in: plan.archive } },
        data: { archived: true },
      });
    }

    const counts: ReconcileCounts = {
      projects: projects.length,
      created,
      linked: plan.link.length,
      restored: plan.restore.length,
      renamed: plan.rename.length,
      archived: plan.archive.length,
    };
    await tx.auditLog.create({
      data: {
        actorId: audit.actorId,
        action: 'work_type.reconcile',
        targetType: audit.targetType,
        targetId: audit.targetId,
        diff: { trigger: audit.trigger, ...counts },
      },
    });
    return counts;
  }

  async listWithTeams(): Promise<WorkTypeWithTeams[]> {
    const rows = await this.prisma.workType.findMany({
      orderBy: { name: 'asc' },
      select: {
        ...WORK_TYPE_SELECT,
        teams: { select: { teamId: true }, orderBy: { teamId: 'asc' } },
      },
    });
    return rows.map(({ teams, ...wt }) => ({ ...wt, teamIds: teams.map((t) => t.teamId) }));
  }

  listAll(): Promise<WorkType[]> {
    return this.prisma.workType.findMany({ orderBy: { name: 'asc' }, select: WORK_TYPE_SELECT });
  }

  async findByIds(ids: readonly string[]): Promise<WorkType[]> {
    if (ids.length === 0) return [];
    return this.prisma.workType.findMany({
      where: { id: { in: [...ids] } },
      select: WORK_TYPE_SELECT,
    });
  }

  async teamExists(teamId: string): Promise<boolean> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    return team !== null;
  }

  /** New catalog entries. No team has selected them yet, so there is nothing to reconcile. */
  async createMany(names: readonly string[], actorId: string): Promise<WorkType[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.workType.createManyAndReturn({
          data: names.map((name) => ({ name })),
          select: WORK_TYPE_SELECT,
        });
        await tx.auditLog.createMany({
          data: created.map((w) => ({
            actorId,
            action: 'work_type.create',
            targetType: 'work_type',
            targetId: w.id,
            diff: { name: w.name },
          })),
        });
        return created;
      });
    } catch (e) {
      // work_types_name_ci_unique: a concurrent create of the same name won the race.
      if (isUniqueViolation(e)) throw catalogConflict('A work type with this name already exists');
      throw e;
    }
  }

  /**
   * Rename and/or archive/restore, audit it, and reconcile every project of every team that has
   * it — one transaction. Returns null when the work type is gone (service → 404).
   */
  async update(
    id: string,
    patch: { name?: string; archived?: boolean },
    actorId: string,
  ): Promise<WorkType | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReconcile(tx);
        const before = await tx.workType.findUnique({ where: { id }, select: WORK_TYPE_SELECT });
        if (!before) return null;
        const workType = await tx.workType.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
          },
          select: WORK_TYPE_SELECT,
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'work_type.update',
            targetType: 'work_type',
            targetId: id,
            diff: {
              before: { name: before.name, archived: before.archived },
              after: { name: workType.name, archived: workType.archived },
            },
          },
        });
        const teams = await tx.teamWorkType.findMany({
          where: { workTypeId: id },
          select: { teamId: true },
        });
        const projects =
          teams.length === 0
            ? []
            : await tx.project.findMany({
                where: { teamId: { in: teams.map((t) => t.teamId) } },
                select: { id: true },
              });
        await this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'work_type_update', targetType: 'work_type', targetId: id },
        );
        return workType;
      }, RECONCILE_TX);
    } catch (e) {
      // Only the name index means "that name is taken"; anything else is the reconcile losing a race.
      if (isNameIndexViolation(e)) {
        throw catalogConflict('A work type with this name already exists');
      }
      if (isConcurrencyConflict(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }

  /**
   * Replace the team's NON-archived selection with `workTypeIds`; links to archived work types
   * are kept so a Restore brings them back for the same teams (plan ruling R5). Deleting a
   * selection row is audited in the same transaction, then every project of the team reconciles.
   */
  async setTeamSelection(
    teamId: string,
    workTypeIds: readonly string[],
    actorId: string,
  ): Promise<TeamWorkTypes> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReconcile(tx);
        const current = await tx.teamWorkType.findMany({
          where: { teamId },
          select: { workTypeId: true, workType: { select: { archived: true } } },
        });
        const keptArchived = current.filter((c) => c.workType.archived).map((c) => c.workTypeId);
        const next = [...new Set([...workTypeIds, ...keptArchived])].sort();

        await tx.teamWorkType.deleteMany({ where: { teamId, workTypeId: { notIn: next } } });
        if (workTypeIds.length > 0) {
          await tx.teamWorkType.createMany({
            data: workTypeIds.map((workTypeId) => ({ teamId, workTypeId })),
            skipDuplicates: true,
          });
        }
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'team.work_types_set',
            targetType: 'team',
            targetId: teamId,
            diff: { before: current.map((c) => c.workTypeId).sort(), after: next },
          },
        });
        const projects = await tx.project.findMany({ where: { teamId }, select: { id: true } });
        await this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'team_selection', targetType: 'team', targetId: teamId },
        );
        return { teamId, workTypeIds: next };
      }, RECONCILE_TX);
    } catch (e) {
      if (isConcurrencyConflict(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }

  /** The admin safety net (spec §8.3): reconcile every project in the org. */
  async resync(actorId: string): Promise<ReconcileCounts> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReconcile(tx);
        const projects = await tx.project.findMany({ select: { id: true } });
        return this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'resync', targetType: 'work_type', targetId: 'all' },
        );
      }, RECONCILE_TX);
    } catch (e) {
      if (isConcurrencyConflict(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }
}
