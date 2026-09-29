import { describe, expect, it } from 'vitest';
import { ZodObject } from 'zod';
import {
  BulkCreateWorkTypesResultSchema,
  BulkCreateWorkTypesSchema,
  ReconcileCountsSchema,
  SetTeamWorkTypesSchema,
  TeamWorkTypesSchema,
  UpdateWorkTypeSchema,
  WorkTypeListSchema,
  WorkTypeSchema,
} from './work-types.js';

const WT = '018f9c1e-0000-7000-8000-000000000001';
const TEAM = '018f9c1e-0000-7000-8000-0000000000c1';

describe('WorkTypeSchema / WorkTypeListSchema', () => {
  it('parses a catalog row with its team ids', () => {
    const row = { id: WT, name: 'Payroll', archived: false, teamIds: [TEAM] };
    expect(WorkTypeListSchema.parse([row])).toEqual([row]);
    expect(WorkTypeSchema.parse({ id: WT, name: 'Payroll', archived: true })).toEqual({
      id: WT,
      name: 'Payroll',
      archived: true,
    });
  });
});

describe('BulkCreateWorkTypesSchema', () => {
  it('accepts 1–100 names and rejects 0 or 101', () => {
    expect(BulkCreateWorkTypesSchema.safeParse({ names: ['A'] }).success).toBe(true);
    expect(BulkCreateWorkTypesSchema.safeParse({ names: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `N${i}`);
    expect(BulkCreateWorkTypesSchema.safeParse({ names: many }).success).toBe(false);
  });

  it('parses the result shape', () => {
    const value = {
      created: [{ id: WT, name: 'Payroll', archived: false }],
      skipped: [{ name: 'General', reason: 'Reserved name' }],
    };
    expect(BulkCreateWorkTypesResultSchema.parse(value)).toEqual(value);
  });
});

describe('UpdateWorkTypeSchema', () => {
  it('accepts a name, an archived flag, or both', () => {
    expect(UpdateWorkTypeSchema.safeParse({ name: 'Payroll' }).success).toBe(true);
    expect(UpdateWorkTypeSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateWorkTypeSchema.safeParse({ name: 'X', archived: false }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(UpdateWorkTypeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty or over-long name', () => {
    expect(UpdateWorkTypeSchema.safeParse({ name: '' }).success).toBe(false);
    expect(UpdateWorkTypeSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('stays a ZodObject so the pipe can apply strict mode (.check, not .refine)', () => {
    expect(UpdateWorkTypeSchema).toBeInstanceOf(ZodObject);
    expect(UpdateWorkTypeSchema.strict().safeParse({ name: 'X', extra: 1 }).success).toBe(false);
  });
});

describe('SetTeamWorkTypesSchema / TeamWorkTypesSchema', () => {
  it('accepts an empty set (clear the team) and up to 100 uuids', () => {
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: [] }).success).toBe(true);
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: [WT] }).success).toBe(true);
  });

  it('rejects a non-uuid and more than 100 ids', () => {
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: ['nope'] }).success).toBe(false);
    const many = Array.from({ length: 101 }, () => WT);
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: many }).success).toBe(false);
  });

  it('parses the PUT response', () => {
    expect(TeamWorkTypesSchema.parse({ teamId: TEAM, workTypeIds: [WT] })).toEqual({
      teamId: TEAM,
      workTypeIds: [WT],
    });
  });
});

describe('ReconcileCountsSchema', () => {
  it('parses non-negative integer counts and rejects negatives', () => {
    const zero = { projects: 0, created: 0, linked: 0, restored: 0, renamed: 0, archived: 0 };
    expect(ReconcileCountsSchema.parse(zero)).toEqual(zero);
    expect(ReconcileCountsSchema.safeParse({ ...zero, created: -1 }).success).toBe(false);
  });
});
