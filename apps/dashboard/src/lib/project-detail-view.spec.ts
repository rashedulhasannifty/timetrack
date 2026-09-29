import { describe, it, expect } from 'vitest';
import type { Subproject } from '@timetrack/contracts';
import {
  toTrendBars,
  toMemberBars,
  toTaskBars,
  groupTasksBySubproject,
  taskMoveOptions,
} from './project-detail-view';

describe('toTrendBars', () => {
  it('maps day → MM-DD label and seconds → rounded hours', () => {
    expect(toTrendBars([{ day: '2026-07-13', trackedSeconds: 5400 }])).toEqual([
      { label: '07-13', hours: 1.5 },
    ]);
  });
  it('empty in → empty out', () => {
    expect(toTrendBars([])).toEqual([]);
  });
});

describe('toMemberBars', () => {
  it('maps name + seconds → hours', () => {
    expect(toMemberBars([{ userId: 'u1', name: 'Jane', trackedSeconds: 3600 }])).toEqual([
      { name: 'Jane', hours: 1 },
    ]);
  });
});

describe('toTaskBars', () => {
  it('maps task name (incl. "No task") + seconds → hours', () => {
    expect(
      toTaskBars([{ taskId: null, subprojectId: null, name: 'No task', trackedSeconds: 1800 }]),
    ).toEqual([{ name: 'No task', hours: 0.5 }]);
  });
});

const sub = (
  id: string,
  name: string,
  extra: Partial<{ archived: boolean; isDefault: boolean }> = {},
) => ({
  id,
  projectId: 'p',
  name,
  archived: false,
  isDefault: false,
  ...extra,
});
const task = (id: string, subprojectId: string, name: string) => ({
  id,
  projectId: 'p',
  subprojectId,
  name,
  archived: false,
});

describe('groupTasksBySubproject', () => {
  it('keeps the API order (default first), nests tasks, and attaches hours', () => {
    const groups = groupTasksBySubproject(
      [sub('g', 'General', { isDefault: true }), sub('c', 'Checkout')],
      [task('t1', 'c', 'Pay'), task('t2', 'g', 'Kickoff')],
      [{ subprojectId: 'c', name: 'Checkout', trackedSeconds: 3600 }],
    );
    expect(
      groups.map((g) => [g.subproject.name, g.trackedSeconds, g.tasks.map((t) => t.name)]),
    ).toEqual([
      ['General', 0, ['Kickoff']],
      ['Checkout', 3600, ['Pay']],
    ]);
  });

  it('drops tasks whose subproject is not in the list rather than crashing', () => {
    expect(
      groupTasksBySubproject(
        [sub('g', 'General', { isDefault: true })],
        [task('t', 'zz', 'Orphan')],
        [],
      )[0]?.tasks,
    ).toEqual([]);
  });
});

describe('taskMoveOptions', () => {
  const sp = (id: string, name: string, archived: boolean): Subproject => ({
    id,
    projectId: 'p',
    name,
    archived,
    isDefault: false,
  });
  const list = [
    sp('a', 'General', false),
    sp('b', 'Old', true),
    sp('c', 'Older', true),
    sp('d', 'Build', false),
  ];

  it('includes the current archived subproject, labelled, and excludes other archived ones', () => {
    expect(taskMoveOptions(list, 'b')).toEqual([
      { id: 'a', label: 'General' },
      { id: 'b', label: 'Old (archived)' },
      { id: 'd', label: 'Build' },
    ]);
  });

  it('offers only active subprojects when the current one is active', () => {
    expect(taskMoveOptions(list, 'a')).toEqual([
      { id: 'a', label: 'General' },
      { id: 'd', label: 'Build' },
    ]);
  });
});
