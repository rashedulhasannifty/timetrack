import { describe, expect, it } from 'vitest';
import {
  ProjectDetailSchema,
  ProjectTaskRowSchema,
  ProjectDetailQuerySchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectSchema,
  ProjectColorSchema,
  TaskSchema,
  UpdateTaskSchema,
  PROJECT_PALETTE,
  ProjectTopAppsSchema,
  ProjectTopAppRowSchema,
  SubprojectSchema,
  CreateSubprojectSchema,
  UpdateSubprojectSchema,
  CreateTaskSchema,
  DEFAULT_SUBPROJECT_NAME,
  BulkCreateProjectsSchema,
  BulkCreateProjectsResultSchema,
  SetProjectTeamsSchema,
  ProjectTeamRowSchema,
} from './projects.js';

describe('ProjectDetailSchema', () => {
  it('parses a full valid detail payload', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-0000000000c1',
      teamIds: ['018f9c1e-0000-7000-8000-0000000000c1'],
      name: 'Website',
      color: '#007aff',
      archived: false,
      totalSeconds: 9000,
      byTeam: [
        {
          teamId: '018f9c1e-0000-7000-8000-0000000000c1',
          teamName: 'Eng',
          trackedSeconds: 9000,
        },
      ],
      trend: [{ day: '2026-07-13', trackedSeconds: 5400 }],
      members: [
        { userId: '018f9c1e-0000-7000-8000-0000000000a1', name: 'Jane', trackedSeconds: 5400 },
        { userId: '018f9c1e-0000-7000-8000-0000000000a2', name: 'John', trackedSeconds: 3600 },
      ],
      subprojects: [
        {
          subprojectId: '018f9c1e-0000-7000-8000-000000000001',
          name: 'General',
          trackedSeconds: 9000,
        },
      ],
      tasks: [
        {
          taskId: '018f9c1e-0000-7000-8000-0000000000b1',
          subprojectId: '018f9c1e-0000-7000-8000-000000000001',
          name: 'Homepage',
          trackedSeconds: 5400,
        },
        { taskId: null, subprojectId: null, name: 'No task', trackedSeconds: 3600 },
      ],
    };
    expect(ProjectDetailSchema.parse(value)).toEqual(value);
  });

  it('accepts a subproject row with a null subprojectId (the "No subproject" bucket)', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-0000000000c1',
      teamIds: ['018f9c1e-0000-7000-8000-0000000000c1'],
      name: 'Website',
      color: null,
      archived: false,
      totalSeconds: 60,
      byTeam: [],
      trend: [],
      members: [],
      subprojects: [{ subprojectId: null, name: 'No subproject', trackedSeconds: 60 }],
      tasks: [],
    };
    expect(ProjectDetailSchema.parse(value)).toEqual(value);
  });

  it('accepts a task row with a null taskId (the "No task" bucket)', () => {
    expect(
      ProjectTaskRowSchema.parse({
        taskId: null,
        subprojectId: null,
        name: 'No task',
        trackedSeconds: 60,
      }),
    ).toEqual({ taskId: null, subprojectId: null, name: 'No task', trackedSeconds: 60 });
  });

  it('rejects a negative trackedSeconds', () => {
    expect(() =>
      ProjectTaskRowSchema.parse({
        taskId: null,
        subprojectId: null,
        name: 'x',
        trackedSeconds: -1,
      }),
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
  it('ProjectColorSchema accepts any #rrggbb, lowercased, and rejects anything else', () => {
    expect(ProjectColorSchema.parse(PROJECT_PALETTE[0])).toBe(PROJECT_PALETTE[0]);
    expect(ProjectColorSchema.parse('#123456')).toBe('#123456');
    expect(ProjectColorSchema.parse('#A1B2C3')).toBe('#a1b2c3');
    for (const bad of ['#12345', '#1234567', '123456', 'red', '#12345g', '']) {
      expect(() => ProjectColorSchema.parse(bad)).toThrow();
    }
  });

  it('CreateProjectSchema requires a color', () => {
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

describe('Task archived + UpdateTaskSchema', () => {
  it('TaskSchema requires archived', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      projectId: '018f9c1e-0000-7000-8000-000000000002',
      subprojectId: '018f9c1e-0000-7000-8000-000000000003',
      name: 'Homepage',
    };
    expect(() => TaskSchema.parse(base)).toThrow(); // missing archived
    expect(TaskSchema.parse({ ...base, archived: false }).archived).toBe(false);
  });

  it('UpdateTaskSchema parses a boolean and rejects empty / non-boolean', () => {
    expect(UpdateTaskSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(() => UpdateTaskSchema.parse({})).toThrow();
    expect(() => UpdateTaskSchema.parse({ archived: 'yes' })).toThrow();
  });
});

describe('ProjectTopAppsSchema', () => {
  it('parses a valid top-apps payload', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      apps: [
        { appName: 'Chrome', trackedSeconds: 7200 },
        { appName: 'VS Code', trackedSeconds: 3600 },
      ],
      coveredSeconds: 10800,
      totalSeconds: 12600,
      coveragePct: 85,
    };
    expect(ProjectTopAppsSchema.parse(value)).toEqual(value);
  });

  it('rejects coveragePct > 100', () => {
    expect(() =>
      ProjectTopAppsSchema.parse({
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
        projectId: '018f9c1e-0000-7000-8000-000000000001',
        apps: [],
        coveredSeconds: 0,
        totalSeconds: 3600,
        coveragePct: 101,
      }),
    ).toThrow();
  });

  it('rejects coveragePct < 0', () => {
    expect(() =>
      ProjectTopAppsSchema.parse({
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
        projectId: '018f9c1e-0000-7000-8000-000000000001',
        apps: [],
        coveredSeconds: 0,
        totalSeconds: 3600,
        coveragePct: -1,
      }),
    ).toThrow();
  });

  it('rejects negative trackedSeconds in an app row', () => {
    expect(() =>
      ProjectTopAppRowSchema.parse({ appName: 'Chrome', trackedSeconds: -100 }),
    ).toThrow();
  });
});

const U1 = '018f9c1e-0000-7000-8000-000000000001';
const U2 = '018f9c1e-0000-7000-8000-000000000002';

describe('subproject schemas', () => {
  it('names the default subproject General', () => {
    expect(DEFAULT_SUBPROJECT_NAME).toBe('General');
  });

  it('SubprojectSchema parses a subproject', () => {
    const v = { id: U1, projectId: U2, name: 'Homepage', archived: false, isDefault: false };
    expect(SubprojectSchema.parse(v)).toEqual(v);
  });

  it('CreateSubprojectSchema requires a 1..200 char name', () => {
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: '' }).success).toBe(false);
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: 'Homepage' }).success).toBe(
      true,
    );
  });

  it('UpdateSubprojectSchema needs at least one field', () => {
    expect(UpdateSubprojectSchema.safeParse({}).success).toBe(false);
    expect(UpdateSubprojectSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateSubprojectSchema.safeParse({ name: 'Checkout' }).success).toBe(true);
  });

  it('UpdateSubprojectSchema injects no defaults', () => {
    expect(UpdateSubprojectSchema.parse({ name: 'A' })).toEqual({ name: 'A' });
  });
});

describe('task schemas with subprojects', () => {
  it('CreateTaskSchema takes a subprojectId, not a projectId', () => {
    expect(CreateTaskSchema.safeParse({ subprojectId: U1, name: 'T' }).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ projectId: U1, name: 'T' }).success).toBe(false);
  });

  it('UpdateTaskSchema accepts archived, a move, or both — but not nothing', () => {
    expect(UpdateTaskSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateTaskSchema.safeParse({ subprojectId: U1 }).success).toBe(true);
    expect(UpdateTaskSchema.safeParse({ archived: false, subprojectId: U1 }).success).toBe(true);
  });

  it('TaskSchema carries subprojectId', () => {
    const t = { id: U1, projectId: U2, subprojectId: U2, name: 'T', archived: false };
    expect(TaskSchema.parse(t)).toEqual(t);
  });
});

describe('BulkCreateProjectsSchema', () => {
  const TEAM = '018f9c1e-0000-7000-8000-0000000000c1';

  it('accepts 1–500 names for a team', () => {
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: ['Acme'] }).success).toBe(
      true,
    );
    const max = Array.from({ length: 500 }, (_, i) => `C${i}`);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: max }).success).toBe(true);
  });

  it('rejects no names, 501 names, and a non-uuid team', () => {
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: [] }).success).toBe(false);
    const over = Array.from({ length: 501 }, (_, i) => `C${i}`);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: over }).success).toBe(false);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: 'x', names: ['A'] }).success).toBe(false);
  });

  it('parses the result with created projects and skips', () => {
    const value = {
      created: [
        {
          id: '018f9c1e-0000-7000-8000-000000000001',
          teamId: TEAM,
          name: 'Acme',
          color: '#007aff',
          archived: false,
        },
      ],
      shared: [],
      skipped: [{ name: 'acme', reason: 'Duplicate in list' }],
    };
    expect(BulkCreateProjectsResultSchema.parse(value)).toEqual(value);
  });

  it('parses existing clients the import shared into the team, with their linked teams', () => {
    const shared = {
      id: '018f9c1e-0000-7000-8000-000000000002',
      teamId: '018f9c1e-0000-7000-8000-0000000000c2',
      teamIds: ['018f9c1e-0000-7000-8000-0000000000c2', TEAM],
      name: 'Globex',
      color: null,
      archived: false,
    };
    const value = { created: [], shared: [shared], skipped: [] };
    expect(BulkCreateProjectsResultSchema.parse(value)).toEqual(value);
    expect(BulkCreateProjectsResultSchema.safeParse({ created: [], skipped: [] }).success).toBe(
      false,
    );
  });
});

describe('SetProjectTeamsSchema', () => {
  const A = '018f9c1e-0000-7000-8000-0000000000a1';
  const B = '018f9c1e-0000-7000-8000-0000000000b1';
  it('accepts a list of unique team ids', () => {
    expect(SetProjectTeamsSchema.parse({ teamIds: [A, B] })).toEqual({ teamIds: [A, B] });
  });
  it('rejects an empty list, a repeat, and a non-uuid', () => {
    expect(SetProjectTeamsSchema.safeParse({ teamIds: [] }).success).toBe(false);
    expect(SetProjectTeamsSchema.safeParse({ teamIds: [A, A] }).success).toBe(false);
    expect(SetProjectTeamsSchema.safeParse({ teamIds: ['x'] }).success).toBe(false);
  });
  it('stays a strict-able ZodObject (the pipe needs .strict())', () => {
    expect(SetProjectTeamsSchema.strict().safeParse({ teamIds: [A], extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('ProjectTeamRowSchema', () => {
  it('allows a null team for the Unassigned bucket', () => {
    expect(
      ProjectTeamRowSchema.parse({ teamId: null, teamName: 'Unassigned', trackedSeconds: 0 }),
    ).toMatchObject({ teamId: null });
  });
});

describe('ProjectSchema.teamIds', () => {
  it('is optional so shipped clients and old responses still parse', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-0000000000c1',
      name: 'Acme',
      color: null,
      archived: false,
    };
    expect(ProjectSchema.safeParse(base).success).toBe(true);
    expect(
      ProjectSchema.parse({ ...base, teamIds: ['018f9c1e-0000-7000-8000-0000000000c1'] }).teamIds,
    ).toHaveLength(1);
  });

  it('ProjectSchema carries an optional home-team name', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-000000000002',
      name: 'Acme',
      color: null,
      archived: false,
    };
    expect(ProjectSchema.parse(base).teamName).toBeUndefined();
    expect(ProjectSchema.parse({ ...base, teamName: 'Design' }).teamName).toBe('Design');
  });
});
