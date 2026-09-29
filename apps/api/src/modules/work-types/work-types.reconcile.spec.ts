import { describe, expect, it } from 'vitest';
import {
  groupRenames,
  planReconcile,
  type DesiredWorkType,
  type ExistingSubproject,
} from './work-types.reconcile.js';

const P1 = { id: 'p1', teamId: 't1' };
const PAYROLL: DesiredWorkType = { id: 'w1', name: 'Payroll' };
const AUDIT: DesiredWorkType = { id: 'w2', name: 'Audit Assist' };

const sub = (over: Partial<ExistingSubproject> & { id: string }): ExistingSubproject => ({
  projectId: 'p1',
  name: 'X',
  archived: false,
  isDefault: false,
  workTypeId: null,
  ...over,
});

const desired = (...wts: DesiredWorkType[]) => new Map([['t1', wts]]);

describe('planReconcile', () => {
  it('creates one row per desired work type that has no row at all', () => {
    const plan = planReconcile([P1], desired(PAYROLL, AUDIT), []);
    expect(plan.create).toEqual([
      { projectId: 'p1', workTypeId: 'w1', name: 'Payroll' },
      { projectId: 'p1', workTypeId: 'w2', name: 'Audit Assist' },
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.archive).toEqual([]);
  });

  it('restores and renames an existing linked row instead of creating one', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'payroll (old)', archived: true, workTypeId: 'w1' }),
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.restore).toEqual(['s1']);
    expect(plan.rename).toEqual([{ id: 's1', name: 'Payroll' }]);
  });

  it('leaves an up-to-date linked row alone', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan).toEqual({ create: [], link: [], restore: [], rename: [], archive: [] });
  });

  it('adopts an unlinked same-name row case-insensitively', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [sub({ id: 's1', name: 'PAYROLL' })]);
    expect(plan.link).toEqual([{ id: 's1', workTypeId: 'w1', name: 'Payroll' }]);
    expect(plan.create).toEqual([]);
  });

  it('prefers a non-archived adoption candidate (ruling R7)', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'Payroll', archived: true }),
      sub({ id: 's2', name: 'payroll' }),
    ]);
    expect(plan.link).toEqual([{ id: 's2', workTypeId: 'w1', name: 'Payroll' }]);
  });

  it('never adopts the General default', () => {
    const general: DesiredWorkType = { id: 'w9', name: 'General' };
    const plan = planReconcile([P1], desired(general), [
      sub({ id: 's0', name: 'General', isDefault: true }),
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([{ projectId: 'p1', workTypeId: 'w9', name: 'General' }]);
  });

  it('archives a linked row that is no longer desired, but not one already archived', () => {
    const plan = planReconcile([P1], desired(), [
      sub({ id: 's1', name: 'Payroll', workTypeId: 'w1' }),
      sub({ id: 's2', name: 'Audit Assist', workTypeId: 'w2', archived: true }),
    ]);
    expect(plan.archive).toEqual(['s1']);
  });

  it('treats a project whose team has no selection as wanting nothing', () => {
    const plan = planReconcile([{ id: 'p2', teamId: 'other' }], desired(PAYROLL), [
      sub({ id: 's1', projectId: 'p2', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan.archive).toEqual(['s1']);
    expect(plan.create).toEqual([]);
  });

  it('keeps projects apart: a row on one project never satisfies another', () => {
    const plan = planReconcile([P1, { id: 'p2', teamId: 't1' }], desired(PAYROLL), [
      sub({ id: 's1', projectId: 'p1', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan.create).toEqual([{ projectId: 'p2', workTypeId: 'w1', name: 'Payroll' }]);
  });
});

describe('groupRenames', () => {
  it('batches row ids by their new name', () => {
    const groups = groupRenames([
      { id: 'a', name: 'Payroll' },
      { id: 'b', name: 'Payroll' },
      { id: 'c', name: 'Audit' },
    ]);
    expect([...groups.entries()]).toEqual([
      ['Payroll', ['a', 'b']],
      ['Audit', ['c']],
    ]);
  });
});
