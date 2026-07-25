import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('projects repository — real Postgres', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  function repo(): ProjectsRepository {
    return new ProjectsRepository(db.prisma as unknown as PrismaService);
  }

  async function seedTeam(name = 'Eng') {
    return db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
  }

  it('createProject inserts the project and writes an audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    expect(project).toMatchObject({ teamId: team.id, name: 'Website', archived: false });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id },
    });
    expect(audit?.action).toBe('project.create');
  });

  it('createTask inserts the task and writes an audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(project.id, 'Homepage', 'actor1');

    expect(task).toMatchObject({ projectId: project.id, name: 'Homepage' });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'task', targetId: task.id },
    });
    expect(audit?.action).toBe('task.create');
  });

  it('setTaskArchived toggles archived and audits archive vs unarchive', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(project.id, 'Homepage', 'actor1');

    const archived = await repo().setTaskArchived(task.id, true, 'actor1');
    expect(archived.archived).toBe(true);
    const unarchived = await repo().setTaskArchived(task.id, false, 'actor1');
    expect(unarchived.archived).toBe(false);

    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'task', targetId: task.id },
      orderBy: { timestamp: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(['task.create', 'task.archive', 'task.unarchive']);
  });

  it('listByTeam nested tasks exclude archived; listTasksForProject includes them', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const active = await repo().createTask(project.id, 'Active', 'actor1');
    const gone = await repo().createTask(project.id, 'Old', 'actor1');
    await repo().setTaskArchived(gone.id, true, 'actor1');

    const listed = await repo().listByTeam(team.id, true);
    const nestedTaskIds = (listed[0]?.tasks ?? []).map((t) => t.id);
    expect(nestedTaskIds).toEqual([active.id]); // archived filtered from assignment list

    const all = await repo().listTasksForProject(project.id);
    expect(all.map((t) => t.id).sort()).toEqual([active.id, gone.id].sort());
    // active-first ordering: the non-archived task precedes the archived one
    expect(all[0]?.id).toBe(active.id);
  });

  it('findTaskForActor returns {projectId, teamId}, or null when missing', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(project.id, 'Homepage', 'actor1');
    expect(await repo().findTaskForActor(task.id)).toEqual({
      projectId: project.id,
      teamId: team.id,
    });
    expect(await repo().findTaskForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('listByTeam excludes archived by default and includes them when asked', async () => {
    const team = await seedTeam();
    const active = await repo().createProject(team.id, 'Active', 'actor1');
    const archivedProject = await repo().createProject(team.id, 'Old', 'actor1');
    await repo().setArchived(archivedProject.id, true, 'actor1');

    const assignable = await repo().listByTeam(team.id);
    expect(assignable.map((p) => p.id)).toEqual([active.id]);

    const all = await repo().listByTeam(team.id, true);
    expect(all.map((p) => p.id).sort()).toEqual([active.id, archivedProject.id].sort());
  });

  it('listByTeam returns projects ordered by name asc', async () => {
    const team = await seedTeam();
    // Insert out of alphabetical order; the repo must return them name-sorted.
    await repo().createProject(team.id, 'Zeta', 'actor1');
    await repo().createProject(team.id, 'Alpha', 'actor1');
    await repo().createProject(team.id, 'Mango', 'actor1');

    const names = (await repo().listByTeam(team.id)).map((p) => p.name);
    expect(names).toEqual(['Alpha', 'Mango', 'Zeta']);
  });

  it('setArchived toggles archived and audits archive vs unarchive', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');

    const archived = await repo().setArchived(project.id, true, 'actor1');
    expect(archived.archived).toBe(true);
    const unarchived = await repo().setArchived(project.id, false, 'actor1');
    expect(unarchived.archived).toBe(false);

    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'project', targetId: project.id },
      orderBy: { timestamp: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'project.create',
      'project.archive',
      'project.unarchive',
    ]);
  });

  it('findForActor returns id/teamId/name/archived, or null when missing', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    expect(await repo().findForActor(project.id)).toEqual({
      id: project.id,
      teamId: team.id,
      name: 'Website',
      color: null,
      archived: false,
    });
    expect(await repo().findForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('createProject persists a color and records it in the audit diff', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1', '#5e5ce6');
    expect(project.color).toBe('#5e5ce6');
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id, action: 'project.create' },
    });
    expect((audit?.diff as { color?: string } | null)?.color).toBe('#5e5ce6');
  });

  it('createProject defaults color to null when omitted', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    expect(project.color).toBeNull();
  });

  it('setColor updates the color and writes a project.recolor audit row', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const recolored = await repo().setColor(project.id, '#ff2d55', 'actor1');
    expect(recolored.color).toBe('#ff2d55');
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'project', targetId: project.id, action: 'project.recolor' },
    });
    expect((audit?.diff as { color?: string } | null)?.color).toBe('#ff2d55');
  });

  async function seedUser(teamId: string, name: string, email: string) {
    return db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  }
  async function seedEntry(
    userId: string,
    projectId: string,
    taskId: string | null,
    startIso: string,
    endIso: string,
  ) {
    await db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        projectId,
        taskId,
        startTime: new Date(startIso),
        endTime: new Date(endIso),
        source: 'MANUAL',
      },
    });
  }

  const FROM = new Date('2026-07-13T00:00:00.000Z');
  const TO = new Date('2026-07-20T00:00:00.000Z');

  it('membersForProject sums per user, descending, with names', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const john = await seedUser(team.id, 'John', 'john@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h
    await seedEntry(john.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h
    const rows = await repo().membersForProject(project.id, FROM, TO);
    expect(rows).toEqual([
      { userId: jane.id, name: 'Jane', trackedSeconds: 7200 },
      { userId: john.id, name: 'John', trackedSeconds: 3600 },
    ]);
  });

  it('tasksForProject buckets by task and rolls null taskId into "No task"', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const task = await repo().createTask(project.id, 'Homepage', 'actor1');
    await seedEntry(jane.id, project.id, task.id, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h Homepage
    await seedEntry(jane.id, project.id, null, '2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z'); // 30m No task
    const rows = await repo().tasksForProject(project.id, FROM, TO);
    expect(rows).toEqual([
      { taskId: task.id, name: 'Homepage', trackedSeconds: 7200 },
      { taskId: null, name: 'No task', trackedSeconds: 1800 },
    ]);
  });

  it('hoursByDay buckets by UTC start-day and clamps to the window', async () => {
    const team = await seedTeam();
    const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h on 14th
    await seedEntry(jane.id, project.id, null, '2026-07-15T09:00:00Z', '2026-07-15T11:00:00Z'); // 2h on 15th
    // An entry starting before the window: clamped to FROM, bucketed on the window's first day.
    await seedEntry(jane.id, project.id, null, '2026-07-12T23:00:00Z', '2026-07-13T01:00:00Z'); // 1h inside window
    const rows = await repo().hoursByDay(project.id, FROM, TO);
    expect(rows).toEqual([
      { day: '2026-07-13', trackedSeconds: 3600 },
      { day: '2026-07-14', trackedSeconds: 3600 },
      { day: '2026-07-15', trackedSeconds: 7200 },
    ]);
  });

  it('aggregations return empty for a project with no entries in range', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Empty', 'actor1');
    expect(await repo().membersForProject(project.id, FROM, TO)).toEqual([]);
    expect(await repo().tasksForProject(project.id, FROM, TO)).toEqual([]);
    expect(await repo().hoursByDay(project.id, FROM, TO)).toEqual([]);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
