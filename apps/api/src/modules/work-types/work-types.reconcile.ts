import { nameKey } from '@timetrack/contracts';

/**
 * The pure half of reconcile (spec §5): given the projects, each team's desired (selected,
 * non-archived) work types and the projects' current non-default subprojects, decide what to
 * create, link, restore, rename and archive. No Prisma here — WorkTypesRepository.reconcile loads
 * the inputs and applies the plan inside the caller's transaction.
 */
export type ReconcileTrigger =
  | 'team_selection'
  | 'work_type_update'
  | 'project_create'
  | 'project_bulk_create'
  | 'project_team_change'
  | 'resync';

export type ReconcileAudit = {
  actorId: string;
  trigger: ReconcileTrigger;
  targetType: 'team' | 'work_type' | 'project';
  targetId: string;
};

export type ReconcileProject = { id: string; teamId: string };
export type DesiredWorkType = { id: string; name: string };
export type ExistingSubproject = {
  id: string;
  projectId: string;
  name: string;
  archived: boolean;
  isDefault: boolean;
  workTypeId: string | null;
};

export type ReconcilePlan = {
  create: { projectId: string; workTypeId: string; name: string }[];
  /** Adopt a hand-made row: set workTypeId, catalog spelling, unarchive. */
  link: { id: string; workTypeId: string; name: string }[];
  restore: string[];
  rename: { id: string; name: string }[];
  archive: string[];
};

export function planReconcile(
  projects: readonly ReconcileProject[],
  desiredByTeam: ReadonlyMap<string, readonly DesiredWorkType[]>,
  subprojects: readonly ExistingSubproject[],
): ReconcilePlan {
  const plan: ReconcilePlan = { create: [], link: [], restore: [], rename: [], archive: [] };

  const byProject = new Map<string, ExistingSubproject[]>();
  for (const s of subprojects) {
    const list = byProject.get(s.projectId);
    if (list) list.push(s);
    else byProject.set(s.projectId, [s]);
  }

  for (const project of projects) {
    const rows = byProject.get(project.id) ?? [];
    const desired = desiredByTeam.get(project.teamId) ?? [];
    const desiredIds = new Set(desired.map((w) => w.id));
    // At most one linked row per work type (partial unique index subprojects_one_per_work_type).
    const linked = new Map<string, ExistingSubproject>();
    for (const row of rows) if (row.workTypeId !== null) linked.set(row.workTypeId, row);

    for (const wt of desired) {
      const row = linked.get(wt.id);
      if (row) {
        // Rule 1: same row id, so the time history stays attached.
        if (row.archived) plan.restore.push(row.id);
        if (row.name !== wt.name) plan.rename.push({ id: row.id, name: wt.name });
        continue;
      }
      // Rule 2: adopt a hand-made row of the same name rather than duplicating it.
      const adoptee = findAdoptee(rows, wt.name);
      if (adoptee) {
        plan.link.push({ id: adoptee.id, workTypeId: wt.id, name: wt.name });
        continue;
      }
      // Rule 3.
      plan.create.push({ projectId: project.id, workTypeId: wt.id, name: wt.name });
    }

    // Rule 4: archive, never delete — reports keep the history.
    for (const [workTypeId, row] of linked) {
      if (!desiredIds.has(workTypeId) && !row.archived) plan.archive.push(row.id);
    }
  }
  return plan;
}

/** Ruling R7: an unlinked, non-default row of the same name; non-archived first, then oldest. */
function findAdoptee(
  rows: readonly ExistingSubproject[],
  name: string,
): ExistingSubproject | undefined {
  const key = nameKey(name);
  const candidates = rows
    .filter((r) => r.workTypeId === null && !r.isDefault && nameKey(r.name) === key)
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates.find((r) => !r.archived) ?? candidates[0];
}

/** Group renames by their new name, so each distinct name is one updateMany. */
export function groupRenames(
  renames: readonly { id: string; name: string }[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const r of renames) {
    const ids = groups.get(r.name);
    if (ids) ids.push(r.id);
    else groups.set(r.name, [r.id]);
  }
  return groups;
}
