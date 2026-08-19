import { describe, it, expect } from 'vitest';
import { toProjectIndexRows } from './projects-index-view';
import { projectColor } from './project-color';
import type { Project, ProjectSummaryRow } from '@timetrack/contracts';

const P = (id: string, name: string, archived = false, color: string | null = null): Project => ({
  id,
  teamId: '018f9c1e-0000-7000-8000-0000000000aa',
  name,
  color,
  archived,
});

describe('toProjectIndexRows', () => {
  it('joins summary hours onto projects by id and attaches a color', () => {
    const projects = [P('p1', 'Alpha'), P('p2', 'Beta')];
    const summary: ProjectSummaryRow[] = [
      { projectId: 'p1', name: 'Alpha', trackedSeconds: 3600 },
      { projectId: 'p2', name: 'Beta', trackedSeconds: 7200 },
    ];
    const { rows } = toProjectIndexRows(projects, summary);
    expect(rows).toEqual([
      {
        projectId: 'p2',
        name: 'Beta',
        archived: false,
        trackedSeconds: 7200,
        color: projectColor('p2'),
        taskCount: 0,
        sharePct: (7200 / 10_800) * 100,
      },
      {
        projectId: 'p1',
        name: 'Alpha',
        archived: false,
        trackedSeconds: 3600,
        color: projectColor('p1'),
        taskCount: 0,
        sharePct: (3600 / 10_800) * 100,
      },
    ]);
  });

  it('shows 0 seconds for a project absent from the summary and still lists it', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Alpha')], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trackedSeconds).toBe(0);
  });

  it('routes the null-projectId bucket to noProjectSeconds, never to rows', () => {
    const summary: ProjectSummaryRow[] = [
      { projectId: null, name: 'No project', trackedSeconds: 1800 },
      { projectId: 'p1', name: 'Alpha', trackedSeconds: 600 },
    ];
    const { rows, noProjectSeconds } = toProjectIndexRows([P('p1', 'Alpha')], summary);
    expect(noProjectSeconds).toBe(1800);
    expect(rows.every((r) => r.projectId !== null)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('includes archived projects (caller decides whether to fetch them)', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Old', true)], []);
    expect(rows[0]?.archived).toBe(true);
  });

  it('sorts by trackedSeconds desc, then name asc', () => {
    const projects = [P('p1', 'Bravo'), P('p2', 'Alpha'), P('p3', 'Charlie')];
    const summary: ProjectSummaryRow[] = [
      { projectId: 'p1', name: 'Bravo', trackedSeconds: 100 },
      { projectId: 'p2', name: 'Alpha', trackedSeconds: 100 },
      { projectId: 'p3', name: 'Charlie', trackedSeconds: 500 },
    ];
    const { rows } = toProjectIndexRows(projects, summary);
    expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('returns empty rows and zero buckets for empty inputs', () => {
    expect(toProjectIndexRows([], [])).toEqual({
      rows: [],
      noProjectSeconds: 0,
      residualSeconds: 0,
      totalSeconds: 0,
    });
  });

  it('uses the stored color when present, else the derived fallback', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Alpha', false, '#ff2d55')], []);
    expect(rows[0]?.color).toBe('#ff2d55');
    const { rows: derived } = toProjectIndexRows([P('p2', 'Beta')], []);
    expect(derived[0]?.color).toBe(projectColor('p2'));
  });
});

describe('toProjectIndexRows — reconciliation', () => {
  it('routes hours for an unknown project id into residualSeconds instead of dropping them', () => {
    // Reachable on the default view: /reports/projects covers archived projects, listProjects
    // returns active-only, so an archived project with in-range hours has no matching project.
    const { rows, residualSeconds, totalSeconds } = toProjectIndexRows(
      [P('p1', 'Alpha')],
      [
        { projectId: 'p1', name: 'Alpha', trackedSeconds: 3600 },
        { projectId: 'gone', name: 'Archived', trackedSeconds: 1800 },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(residualSeconds).toBe(1800);
    expect(totalSeconds).toBe(5400);
  });

  it('accounts for every second across rows and both buckets', () => {
    const view = toProjectIndexRows(
      [P('p1', 'Alpha')],
      [
        { projectId: 'p1', name: 'Alpha', trackedSeconds: 3600 },
        { projectId: 'gone', name: 'Archived', trackedSeconds: 1800 },
        { projectId: null, name: 'No project', trackedSeconds: 600 },
      ],
    );
    const accounted =
      view.rows.reduce((s, r) => s + r.trackedSeconds, 0) +
      view.residualSeconds +
      view.noProjectSeconds;
    expect(accounted).toBe(view.totalSeconds);
  });

  it('makes the shares add up to 100 across rows and both buckets', () => {
    const view = toProjectIndexRows(
      [P('p1', 'Alpha'), P('p2', 'Beta')],
      [
        { projectId: 'p1', name: 'Alpha', trackedSeconds: 3600 },
        { projectId: 'p2', name: 'Beta', trackedSeconds: 1800 },
        { projectId: 'gone', name: 'Archived', trackedSeconds: 900 },
        { projectId: null, name: 'No project', trackedSeconds: 900 },
      ],
    );
    const bucketShare = ((view.residualSeconds + view.noProjectSeconds) / view.totalSeconds) * 100;
    const rowShare = view.rows.reduce((s, r) => s + r.sharePct, 0);
    expect(rowShare + bucketShare).toBeCloseTo(100, 6);
  });

  it('counts a project’s tasks when the list endpoint nested them', () => {
    const withTasks: Project = {
      ...P('p1', 'Alpha'),
      tasks: [
        { id: 't1', projectId: 'p1', name: 'One', archived: false },
        { id: 't2', projectId: 'p1', name: 'Two', archived: false },
      ],
    };
    expect(toProjectIndexRows([withTasks], []).rows[0]!.taskCount).toBe(2);
  });

  it('reports zero tasks when the response omitted them', () => {
    expect(toProjectIndexRows([P('p1', 'Alpha')], []).rows[0]!.taskCount).toBe(0);
  });

  it('never divides by zero when the range has no tracked time', () => {
    expect(toProjectIndexRows([P('p1', 'Alpha')], []).rows[0]!.sharePct).toBe(0);
  });
});
