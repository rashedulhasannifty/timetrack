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

  it('findForActor returns id/teamId/archived, or null when missing', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    expect(await repo().findForActor(project.id)).toEqual({
      id: project.id,
      teamId: team.id,
      archived: false,
    });
    expect(await repo().findForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
