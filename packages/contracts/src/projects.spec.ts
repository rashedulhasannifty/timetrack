import { describe, expect, it } from 'vitest';
import {
  ProjectDetailSchema,
  ProjectTaskRowSchema,
  ProjectDetailQuerySchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectSchema,
  ProjectColorSchema,
  PROJECT_PALETTE,
} from './projects.js';

describe('ProjectDetailSchema', () => {
  it('parses a full valid detail payload', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      name: 'Website',
      color: '#007aff',
      archived: false,
      totalSeconds: 9000,
      trend: [{ day: '2026-07-13', trackedSeconds: 5400 }],
      members: [
        { userId: '018f9c1e-0000-7000-8000-0000000000a1', name: 'Jane', trackedSeconds: 5400 },
        { userId: '018f9c1e-0000-7000-8000-0000000000a2', name: 'John', trackedSeconds: 3600 },
      ],
      tasks: [
        { taskId: '018f9c1e-0000-7000-8000-0000000000b1', name: 'Homepage', trackedSeconds: 5400 },
        { taskId: null, name: 'No task', trackedSeconds: 3600 },
      ],
    };
    expect(ProjectDetailSchema.parse(value)).toEqual(value);
  });

  it('accepts a task row with a null taskId (the "No task" bucket)', () => {
    expect(
      ProjectTaskRowSchema.parse({ taskId: null, name: 'No task', trackedSeconds: 60 }),
    ).toEqual({ taskId: null, name: 'No task', trackedSeconds: 60 });
  });

  it('rejects a negative trackedSeconds', () => {
    expect(() =>
      ProjectTaskRowSchema.parse({ taskId: null, name: 'x', trackedSeconds: -1 }),
    ).toThrow();
  });

  it('parses the detail query range', () => {
    expect(
      ProjectDetailQuerySchema.parse({
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
      }),
    ).toEqual({ from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' });
  });
});

describe('ProjectColor + color fields', () => {
  it('ProjectColorSchema accepts a palette value and rejects a non-palette hex', () => {
    expect(ProjectColorSchema.parse(PROJECT_PALETTE[0])).toBe(PROJECT_PALETTE[0]);
    expect(() => ProjectColorSchema.parse('#123456')).toThrow();
  });

  it('CreateProjectSchema requires a palette color', () => {
    const base = { teamId: '018f9c1e-0000-7000-8000-000000000001', name: 'Website' };
    expect(() => CreateProjectSchema.parse(base)).toThrow(); // missing color
    expect(CreateProjectSchema.parse({ ...base, color: PROJECT_PALETTE[1] }).color).toBe(
      PROJECT_PALETTE[1],
    );
  });

  it('UpdateProjectSchema accepts archived-only, color-only, or both', () => {
    expect(UpdateProjectSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(UpdateProjectSchema.parse({ color: PROJECT_PALETTE[2] })).toEqual({
      color: PROJECT_PALETTE[2],
    });
    expect(UpdateProjectSchema.parse({ archived: false, color: PROJECT_PALETTE[3] })).toEqual({
      archived: false,
      color: PROJECT_PALETTE[3],
    });
  });

  it('ProjectSchema.color accepts null and any stored string (read is permissive)', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-000000000002',
      name: 'Website',
      archived: false,
    };
    expect(ProjectSchema.parse({ ...base, color: null }).color).toBeNull();
    expect(ProjectSchema.parse({ ...base, color: '#legacy' }).color).toBe('#legacy');
  });
});
