import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { ReconcileCounts } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  groupRenames,
  planReconcile,
  type DesiredWorkType,
  type ReconcileAudit,
} from './work-types.reconcile.js';

/**
 * Transaction options for anything that reconciles many projects. Prisma's interactive
 * transaction defaults to 5s, which a whole-org re-sync (≈100 clients × 12 work types) or a
 * 500-client import can exceed — it then P2028-rolls-back while every small-seed test passes.
 */
export const RECONCILE_TX = { timeout: 60_000, maxWait: 10_000 } as const;

export const CONCURRENT_CHANGE = 'The catalog changed while saving. Try again.';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export function catalogConflict(title: string): ConflictException {
  return new ConflictException({
    type: 'https://timetrack.internal/errors/conflict',
    title,
    status: 409,
  });
}

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class WorkTypesRepository {
  // Explicit token: see projects.service.ts — vitest drops design:paramtypes.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The single sync rule (spec §5). Runs inside the CALLER's transaction so a project create,
   * bulk import, team move, selection save or catalog edit commits together with its subprojects.
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
}
