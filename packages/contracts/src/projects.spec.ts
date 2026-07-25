import { describe, expect, it } from 'vitest';
import { ProjectDetailSchema, ProjectTaskRowSchema, ProjectDetailQuerySchema } from './projects.js';

describe('ProjectDetailSchema', () => {
  it('parses a full valid detail payload', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      name: 'Website',
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
