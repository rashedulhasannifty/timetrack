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
      },
      {
        projectId: 'p1',
        name: 'Alpha',
        archived: false,
        trackedSeconds: 3600,
        color: projectColor('p1'),
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

  it('returns empty rows and zero bucket for empty inputs', () => {
    expect(toProjectIndexRows([], [])).toEqual({ rows: [], noProjectSeconds: 0 });
  });

  it('uses the stored color when present, else the derived fallback', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Alpha', false, '#ff2d55')], []);
    expect(rows[0]?.color).toBe('#ff2d55');
    const { rows: derived } = toProjectIndexRows([P('p2', 'Beta')], []);
    expect(derived[0]?.color).toBe(projectColor('p2'));
  });
});
