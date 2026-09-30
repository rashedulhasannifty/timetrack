import type {
  Project,
  ReconcileCounts,
  TeamListItem,
  WorkTypeWithTeams,
} from '@timetrack/contracts';

type TeamRef = Pick<TeamListItem, 'id' | 'name'>;

export type CatalogTeam = { id: string; name: string; selectedCount: number };
export type CatalogCell = { teamId: string; checked: boolean };
export type CatalogRow = {
  workTypeId: string;
  name: string;
  archived: boolean;
  cells: CatalogCell[];
};
export type CatalogMatrix = { teams: CatalogTeam[]; rows: CatalogRow[] };

export type TeamSaveDiff = {
  /** The PUT body: selected, non-archived, known ids, in catalog order. */
  workTypeIds: string[];
  added: string[];
  removed: string[];
  changed: boolean;
};

export type ClientRow = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  /** Linked teams, home first; one entry unless the client is shared. */
  teams: { id: string; name: string }[];
  shared: boolean;
  archived: boolean;
};

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The DOM id of a team column's Save form. */
export function teamFormId(teamId: string): string {
  return `work-types-team-${teamId}`;
}

/** Per team, the ticked work type ids (sorted). Held in client state, not in the DOM. */
export type ColumnTicks = Record<string, string[]>;

/** The server's selection as ticks — every link, archived ones included (they show ticked). */
export function columnTicks(matrix: CatalogMatrix): ColumnTicks {
  const ticks: ColumnTicks = {};
  for (const t of matrix.teams) {
    ticks[t.id] = matrix.rows
      .filter((r) => r.cells.some((c) => c.teamId === t.id && c.checked))
      .map((r) => r.workTypeId)
      .sort();
  }
  return ticks;
}

/** One checkbox changed. Returns a new object; other columns are untouched. Pure. */
export function toggleColumnTick(
  ticks: ColumnTicks,
  teamId: string,
  workTypeId: string,
  checked: boolean,
): ColumnTicks {
  const rest = (ticks[teamId] ?? []).filter((id) => id !== workTypeId);
  return { ...ticks, [teamId]: checked ? [...rest, workTypeId].sort() : rest };
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Fresh server props arrived. A column whose SERVER selection changed (its save succeeded, or
 * someone else saved it) adopts the server's; any other column keeps the admin's unsaved ticks —
 * which is what keeps them after a failed save, since React resets a form after its action. Pure.
 */
export function syncColumnTicks(
  prevServer: ColumnTicks,
  nextServer: ColumnTicks,
  ticks: ColumnTicks,
): ColumnTicks {
  const synced: ColumnTicks = {};
  for (const [teamId, server] of Object.entries(nextServer)) {
    const kept = ticks[teamId];
    synced[teamId] = sameIds(prevServer[teamId], server) && kept !== undefined ? kept : server;
  }
  return synced;
}

/** What one column's Save submits: its ticked, non-archived ids, in row order. Pure. */
export function columnSubmission(
  matrix: CatalogMatrix,
  ticks: ColumnTicks,
  teamId: string,
): string[] {
  const ticked = new Set(ticks[teamId] ?? []);
  return matrix.rows
    .filter((r) => !r.archived && ticked.has(r.workTypeId))
    .map((r) => r.workTypeId);
}

/** Rows are work types (active first, then archived; each by name), columns are teams. Pure. */
export function buildCatalogMatrix(
  workTypes: readonly WorkTypeWithTeams[],
  teams: readonly TeamRef[],
): CatalogMatrix {
  const ordered = [...workTypes].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || byName(a, b),
  );
  return {
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      selectedCount: workTypes.filter((w) => !w.archived && w.teamIds.includes(t.id)).length,
    })),
    rows: ordered.map((wt) => ({
      workTypeId: wt.id,
      name: wt.name,
      archived: wt.archived,
      cells: teams.map((t) => ({ teamId: t.id, checked: wt.teamIds.includes(t.id) })),
    })),
  };
}

/**
 * What saving one team column does. Archived and unknown ids are dropped from the PUT body and
 * never count as removed: the server keeps archived links (plan ruling R5). Pure.
 */
export function teamSaveDiff(
  workTypes: readonly WorkTypeWithTeams[],
  teamId: string,
  submitted: readonly string[],
): TeamSaveDiff {
  const active = workTypes.filter((w) => !w.archived);
  const wanted = new Set(submitted);
  const workTypeIds = active.filter((w) => wanted.has(w.id)).map((w) => w.id);
  const current = active.filter((w) => w.teamIds.includes(teamId)).map((w) => w.id);
  const currentSet = new Set(current);
  const added = workTypeIds.filter((id) => !currentSet.has(id));
  const removed = current.filter((id) => !wanted.has(id));
  return { workTypeIds, added, removed, changed: added.length > 0 || removed.length > 0 };
}

export function describeTeamSave(diff: TeamSaveDiff, teamName: string): string {
  if (!diff.changed) return `No changes for ${teamName}`;
  return `${teamName}: ${diff.added.length} added, ${diff.removed.length} removed`;
}

export function describeCounts(c: ReconcileCounts): string {
  const clients = `${c.projects} ${c.projects === 1 ? 'client' : 'clients'} checked`;
  return `${clients} · ${c.created} created · ${c.linked} linked · ${c.restored} restored · ${c.renamed} renamed · ${c.archived} archived`;
}

/** Every client of every team, for the clients table. Pure. */
export function clientRows(teams: readonly TeamRef[], projects: readonly Project[]): ClientRow[] {
  const names = new Map(teams.map((t) => [t.id, t.name] as const));
  return projects
    .map((p) => {
      const ids = p.teamIds ?? [p.teamId];
      return {
        id: p.id,
        name: p.name,
        teamId: p.teamId,
        teamName: names.get(p.teamId) ?? 'Unknown team',
        teams: ids.map((id) => ({ id, name: names.get(id) ?? 'Unknown team' })),
        shared: ids.length > 1,
        archived: p.archived,
      };
    })
    .sort((a, b) => byName(a, b) || a.teamName.localeCompare(b.teamName));
}
