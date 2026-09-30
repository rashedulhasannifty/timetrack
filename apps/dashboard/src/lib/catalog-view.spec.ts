import { describe, expect, it } from 'vitest';
import type { Project, WorkTypeWithTeams } from '@timetrack/contracts';
import {
  buildCatalogMatrix,
  clientRows,
  columnSubmission,
  columnTicks,
  syncColumnTicks,
  toggleColumnTick,
  describeCounts,
  describeImport,
  describeTeamSave,
  teamFormId,
  teamSaveDiff,
} from './catalog-view';

const ENG = { id: 't-eng', name: 'Eng' };
const OPS = { id: 't-ops', name: 'Ops' };
const WT = (id: string, name: string, teamIds: string[], archived = false): WorkTypeWithTeams => ({
  id,
  name,
  archived,
  teamIds,
});

const CATALOG = [
  WT('w-pay', 'Payroll', ['t-eng']),
  WT('w-old', 'Legacy', ['t-eng'], true),
  WT('w-adh', 'adhoc', ['t-eng', 't-ops']),
  WT('w-aud', 'Audit Assist', []),
];

describe('buildCatalogMatrix', () => {
  it('puts active work types first by name (case-insensitive), archived last', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    expect(m.rows.map((r) => r.name)).toEqual(['adhoc', 'Audit Assist', 'Payroll', 'Legacy']);
  });

  it('builds one cell per team, checked where the team has selected it', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    const adhoc = m.rows.find((r) => r.workTypeId === 'w-adh');
    expect(adhoc?.cells).toEqual([
      { teamId: 't-eng', checked: true },
      { teamId: 't-ops', checked: true },
    ]);
    const audit = m.rows.find((r) => r.workTypeId === 'w-aud');
    expect(audit?.cells.map((c) => c.checked)).toEqual([false, false]);
  });

  it('counts only active selections per team', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    expect(m.teams).toEqual([
      { id: 't-eng', name: 'Eng', selectedCount: 2 },
      { id: 't-ops', name: 'Ops', selectedCount: 1 },
    ]);
  });

  it('handles an empty catalog', () => {
    expect(buildCatalogMatrix([], [ENG])).toEqual({
      teams: [{ id: 't-eng', name: 'Eng', selectedCount: 0 }],
      rows: [],
    });
  });
});

describe('teamSaveDiff', () => {
  it('reports what a column save adds and removes, in catalog order', () => {
    const diff = teamSaveDiff(CATALOG, 't-eng', ['w-aud', 'w-adh']);
    expect(diff).toEqual({
      workTypeIds: ['w-adh', 'w-aud'],
      added: ['w-aud'],
      removed: ['w-pay'],
      changed: true,
    });
  });

  it('never sends archived or unknown ids (ruling R5) and never counts them as removed', () => {
    const diff = teamSaveDiff(CATALOG, 't-eng', ['w-old', 'nope', 'w-pay', 'w-adh']);
    expect(diff).toEqual({
      workTypeIds: ['w-pay', 'w-adh'],
      added: [],
      removed: [],
      changed: false,
    });
  });

  it('clearing a column removes every active selection', () => {
    expect(teamSaveDiff(CATALOG, 't-ops', [])).toEqual({
      workTypeIds: [],
      added: [],
      removed: ['w-adh'],
      changed: true,
    });
  });
});

describe('describeTeamSave / describeCounts / teamFormId', () => {
  it('words a save and a no-op', () => {
    expect(describeTeamSave(teamSaveDiff(CATALOG, 't-eng', ['w-aud']), 'Eng')).toBe(
      'Eng: 1 added, 2 removed',
    );
    expect(describeTeamSave(teamSaveDiff(CATALOG, 't-eng', ['w-pay', 'w-adh']), 'Eng')).toBe(
      'No changes for Eng',
    );
  });

  it('words re-sync counts, singular and plural', () => {
    const base = { created: 3, linked: 1, restored: 0, renamed: 2, archived: 0 };
    expect(describeCounts({ projects: 1, ...base })).toBe(
      '1 client checked · 3 created · 1 linked · 0 restored · 2 renamed · 0 archived',
    );
    expect(describeCounts({ projects: 98, ...base })).toMatch(/^98 clients checked/);
  });

  it('gives each team column a stable, distinct form id', () => {
    expect(teamFormId('t-eng')).toBe('work-types-team-t-eng');
    expect(teamFormId('t-eng')).not.toBe(teamFormId('t-ops'));
  });
});

describe('clientRows', () => {
  const P = (id: string, name: string, teamId: string, archived = false): Project => ({
    id,
    teamId,
    name,
    color: null,
    archived,
  });

  it('joins team names and sorts by client name, then team', () => {
    const rows = clientRows(
      [ENG, OPS],
      [P('p1', 'Zeta', 't-eng'), P('p2', 'acme', 't-ops', true), P('p3', 'Acme', 't-eng')],
    );
    expect(rows.map((r) => [r.name, r.teamName, r.archived])).toEqual([
      ['Acme', 'Eng', false],
      ['acme', 'Ops', true],
      ['Zeta', 'Eng', false],
    ]);
  });

  it('labels a project whose team is not in the list', () => {
    expect(clientRows([], [P('p1', 'Lost', 't-gone')])[0]?.teamName).toBe('Unknown team');
  });
});

describe('team column ticks (kept in client state so a failed save keeps them)', () => {
  const matrix = buildCatalogMatrix(CATALOG, [ENG, OPS]);

  it('starts from the server selection, per team, including archived links', () => {
    expect(columnTicks(matrix)).toEqual({
      't-eng': ['w-adh', 'w-old', 'w-pay'],
      't-ops': ['w-adh'],
    });
  });

  it('ticks and unticks one cell without touching the other columns', () => {
    const ticks = columnTicks(matrix);
    const added = toggleColumnTick(ticks, 't-ops', 'w-aud', true);
    expect(added).toEqual({ 't-eng': ['w-adh', 'w-old', 'w-pay'], 't-ops': ['w-adh', 'w-aud'] });
    expect(toggleColumnTick(added, 't-ops', 'w-adh', false)['t-ops']).toEqual(['w-aud']);
    expect(toggleColumnTick(added, 't-ops', 'w-aud', true)).toEqual(added);
    expect(ticks['t-ops']).toEqual(['w-adh']); // not mutated
  });

  it('keeps unsaved ticks while the server selection is unchanged (a failed save)', () => {
    const server = columnTicks(matrix);
    const ticked = toggleColumnTick(server, 't-ops', 'w-aud', true);
    // A failed save does not change the server state; an unrelated revalidation re-sends it.
    expect(syncColumnTicks(server, columnTicks(matrix), ticked)).toEqual(ticked);
  });

  it("adopts the server's column once that team's selection changed (a successful save)", () => {
    const server = columnTicks(matrix);
    const ticked = toggleColumnTick(
      toggleColumnTick(server, 't-ops', 'w-aud', true),
      't-eng',
      'w-pay',
      false,
    );
    const saved = buildCatalogMatrix(
      CATALOG.map((w) => (w.id === 'w-aud' ? { ...w, teamIds: ['t-ops'] } : w)),
      [ENG, OPS],
    );
    // Ops saved and changed on the server; Eng's unsaved untick survives.
    expect(syncColumnTicks(server, columnTicks(saved), ticked)).toEqual({
      't-eng': ['w-adh', 'w-old'],
      't-ops': ['w-adh', 'w-aud'],
    });
  });

  it('picks up a team that is new on the server', () => {
    const server = columnTicks(matrix);
    const next = { ...server, 't-new': ['w-pay'] };
    expect(syncColumnTicks(server, next, server)['t-new']).toEqual(['w-pay']);
  });

  it('submits only ticked, non-archived ids, in row order', () => {
    const ticks = toggleColumnTick(columnTicks(matrix), 't-eng', 'w-aud', true);
    expect(columnSubmission(matrix, ticks, 't-eng')).toEqual(['w-adh', 'w-aud', 'w-pay']);
    expect(columnSubmission(matrix, ticks, 't-missing')).toEqual([]);
  });
});

describe('clientRows with shared clients', () => {
  const teams = [
    { id: 't1', name: 'Eng' },
    { id: 't2', name: 'Ops' },
  ];
  const project = (over: Partial<Project>): Project => ({
    id: 'p1',
    teamId: 't1',
    name: 'Acme',
    color: null,
    archived: false,
    ...over,
  });
  it('lists linked teams home first and marks 2+ as shared', () => {
    const [row] = clientRows(teams, [project({ teamIds: ['t1', 't2'] })]);
    expect(row).toMatchObject({
      teams: [
        { id: 't1', name: 'Eng' },
        { id: 't2', name: 'Ops' },
      ],
      shared: true,
    });
  });
  it('falls back to the home team when teamIds is absent', () => {
    const [row] = clientRows(teams, [project({})]);
    expect(row).toMatchObject({ teams: [{ id: 't1', name: 'Eng' }], shared: false });
  });
});

describe('describeImport', () => {
  it('counts created, shared and skipped clients', () => {
    expect(describeImport({ created: 2, shared: 1, skipped: 0 })).toBe(
      '2 imported, 1 shared with this team, 0 skipped',
    );
  });
  it('leaves out the shared count when nothing was shared', () => {
    expect(describeImport({ created: 1, shared: 0, skipped: 3 })).toBe('1 imported, 3 skipped');
  });
});
