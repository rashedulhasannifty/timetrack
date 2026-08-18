import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import type { ProjectsRepository } from './projects.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function makeService(overrides: Partial<ProjectsRepository> = {}) {
  const repo = {
    listByTeam: vi.fn(),
    createProject: vi.fn(),
    createTask: vi.fn(),
    findForActor: vi.fn(),
    setArchived: vi.fn(),
    setColor: vi.fn(),
    hoursByDay: vi.fn(),
    membersForProject: vi.fn(),
    tasksForProject: vi.fn(),
    topAppsForProject: vi.fn(),
    listTasksForProject: vi.fn(),
    findTaskForActor: vi.fn(),
    setTaskArchived: vi.fn(),
    setTeam: vi.fn(),
    ...overrides,
  } as unknown as ProjectsRepository;
  return { svc: new ProjectsService(repo), repo };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectsService.createProject', () => {
  it('rejects creating a project for another team (403)', async () => {
    const { svc, repo } = makeService();
    await expect(
      svc.createProject({ teamId: 't2', name: 'X', color: '#007aff' }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createProject).not.toHaveBeenCalled();
  });

  it('creates when the team matches the actor, threading color', async () => {
    const created = { id: 'p1', teamId: 't1', name: 'X', color: '#007aff', archived: false };
    const { svc, repo } = makeService({ createProject: vi.fn().mockResolvedValue(created) });
    await expect(
      svc.createProject({ teamId: 't1', name: 'X', color: '#007aff' }, manager),
    ).resolves.toEqual(created);
    expect(repo.createProject).toHaveBeenCalledWith('t1', 'X', 'm1', '#007aff');
  });
});

describe('ProjectsService.createTask', () => {
  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.createTask({ projectId: 'p9', name: 'T' }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 when the project belongs to another team', async () => {
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't2', archived: false }),
    });
    await expect(svc.createTask({ projectId: 'p1', name: 'T' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.createTask).not.toHaveBeenCalled();
  });

  it('creates the task with (projectId, name, actorId) when the team matches', async () => {
    const created = { id: 'task1', projectId: 'p1', name: 'T' };
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1', archived: false }),
      createTask: vi.fn().mockResolvedValue(created),
    });
    await expect(svc.createTask({ projectId: 'p1', name: 'T' }, manager)).resolves.toEqual(created);
    expect(repo.createTask).toHaveBeenCalledWith('p1', 'T', 'm1');
  });
});

describe('ProjectsService.update', () => {
  it("403 when updating another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', color: null, archived: false }),
    });
    await expect(svc.update('p1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setArchived).not.toHaveBeenCalled();
  });

  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.update('p9', { archived: true }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('dispatches archived → setArchived', async () => {
    const updated = { id: 'p1', teamId: 't1', name: 'X', color: null, archived: true };
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      setArchived: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.update('p1', { archived: true }, manager)).resolves.toEqual(updated);
    expect(repo.setArchived).toHaveBeenCalledWith('p1', true, 'm1');
    expect(repo.setColor).not.toHaveBeenCalled();
  });

  it('dispatches color → setColor', async () => {
    const updated = { id: 'p1', teamId: 't1', name: 'X', color: '#ff2d55', archived: false };
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      setColor: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.update('p1', { color: '#ff2d55' }, manager)).resolves.toEqual(updated);
    expect(repo.setColor).toHaveBeenCalledWith('p1', '#ff2d55', 'm1');
    expect(repo.setArchived).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.list', () => {
  it('passes includeArchived through to the repo', async () => {
    const { svc, repo } = makeService({ listByTeam: vi.fn().mockResolvedValue([]) });
    await svc.list(manager, true);
    expect(repo.listByTeam).toHaveBeenCalledWith('t1', true);
  });
});

describe('ProjectsService.detail', () => {
  const query = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' };

  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.detail('p9', query, manager)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("403 for another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', archived: false }),
    });
    await expect(svc.detail('p1', query, manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.membersForProject).not.toHaveBeenCalled();
  });

  it('assembles detail with totalSeconds = sum of members', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const { svc } = makeService({
      findForActor: vi.fn().mockResolvedValue({
        id: projectId,
        teamId: 't1',
        name: 'Website',
        color: '#34c759',
        archived: false,
      }),
      hoursByDay: vi.fn().mockResolvedValue([
        { day: '2026-07-14', trackedSeconds: 5000 },
        { day: '2026-07-15', trackedSeconds: 1234 },
      ]),
      membersForProject: vi.fn().mockResolvedValue([
        { userId: '22222222-2222-4222-8222-222222222222', name: 'Jane', trackedSeconds: 7200 },
        { userId: '33333333-3333-4333-8333-333333333333', name: 'John', trackedSeconds: 1800 },
      ]),
      tasksForProject: vi
        .fn()
        .mockResolvedValue([{ taskId: null, name: 'No task', trackedSeconds: 4321 }]),
    });
    const result = await svc.detail(projectId, query, manager);
    expect(result.projectId).toBe(projectId);
    expect(result.name).toBe('Website');
    expect(result.color).toBe('#34c759');
    expect(result.totalSeconds).toBe(9000);
    expect(result.members).toHaveLength(2);
    expect(result.tasks[0]).toEqual({ taskId: null, name: 'No task', trackedSeconds: 4321 });
    expect(result.from).toBe(query.from);
  });
});

describe('ProjectsService.listTasks', () => {
  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.listTasks('p9', manager)).rejects.toBeInstanceOf(NotFoundException);
  });
  it("403 for another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', color: null, archived: false }),
    });
    await expect(svc.listTasks('p1', manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listTasksForProject).not.toHaveBeenCalled();
  });
  it('returns the project tasks when own-team', async () => {
    const tasks = [{ id: 't1', projectId: 'p1', name: 'A', archived: false }];
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      listTasksForProject: vi.fn().mockResolvedValue(tasks),
    });
    await expect(svc.listTasks('p1', manager)).resolves.toEqual(tasks);
    expect(repo.listTasksForProject).toHaveBeenCalledWith('p1');
  });
});

describe('ProjectsService.topApps', () => {
  const query = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' };

  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.topApps('p9', query, manager)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("403 for another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', color: null, archived: false }),
    });
    await expect(svc.topApps('p1', query, manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.topAppsForProject).not.toHaveBeenCalled();
  });

  it('computes coveredSeconds and coveragePct from the repo apps/totalSeconds', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const apps = [
      { appName: 'Xcode', trackedSeconds: 2400 },
      { appName: 'Terminal', trackedSeconds: 1200 },
    ];
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({
        id: projectId,
        teamId: 't1',
        name: 'Website',
        color: '#34c759',
        archived: false,
      }),
      topAppsForProject: vi.fn().mockResolvedValue({ apps, totalSeconds: 7200 }),
    });
    const result = await svc.topApps(projectId, query, manager);
    expect(repo.topAppsForProject).toHaveBeenCalledWith(
      projectId,
      new Date(query.from),
      new Date(query.to),
    );
    expect(result).toEqual({
      from: query.from,
      to: query.to,
      projectId,
      apps,
      coveredSeconds: 3600,
      totalSeconds: 7200,
      coveragePct: 50,
    });
  });

  it('coveragePct is 0 when totalSeconds is 0', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const { svc } = makeService({
      findForActor: vi.fn().mockResolvedValue({
        id: projectId,
        teamId: 't1',
        name: 'Website',
        color: null,
        archived: false,
      }),
      topAppsForProject: vi.fn().mockResolvedValue({ apps: [], totalSeconds: 0 }),
    });
    const result = await svc.topApps(projectId, query, manager);
    expect(result.coveragePct).toBe(0);
    expect(result.coveredSeconds).toBe(0);
  });
});

describe('ProjectsService.setTaskArchived', () => {
  it('404 when the task does not exist', async () => {
    const { svc } = makeService({ findTaskForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.setTaskArchived('t9', { archived: true }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it("403 for a task in another team's project", async () => {
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue({ projectId: 'p1', teamId: 't2' }),
    });
    await expect(svc.setTaskArchived('t1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setTaskArchived).not.toHaveBeenCalled();
  });
  it('archives when own-team', async () => {
    const updated = { id: 't1', projectId: 'p1', name: 'A', archived: true };
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue({ projectId: 'p1', teamId: 't1' }),
      setTaskArchived: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.setTaskArchived('t1', { archived: true }, manager)).resolves.toEqual(updated);
    expect(repo.setTaskArchived).toHaveBeenCalledWith('t1', true, 'm1');
  });
});

const employee: SessionUser = { id: 'e1', role: 'EMPLOYEE', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const OTHER = 't2';

/**
 * Which team's projects you get. GET /projects carries no @Roles — the macOS client calls it
 * as an EMPLOYEE — so the role check in the service IS the gate, and these pin it.
 */
describe('ProjectsService.list team scoping', () => {
  it('defaults everyone to their own team', async () => {
    const { svc, repo } = makeService();
    await svc.list(manager, false);
    expect(repo.listByTeam).toHaveBeenCalledWith('t1', false);
  });

  it('lets an ADMIN read another team — the only way to find a stranded project', async () => {
    const { svc, repo } = makeService();
    await svc.list(admin, false, OTHER);
    expect(repo.listByTeam).toHaveBeenCalledWith(OTHER, false);
  });

  it('403s a MANAGER naming another team', async () => {
    const { svc, repo } = makeService();
    await expect(svc.list(manager, false, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listByTeam).not.toHaveBeenCalled();
  });

  it('pins an EMPLOYEE to their own team however the query is set', async () => {
    // Not a 403 — the parameter is ignored, exactly like reports. An employee cannot widen
    // their own scope by guessing a team id.
    const { svc, repo } = makeService();
    await svc.list(employee, false, OTHER);
    expect(repo.listByTeam).toHaveBeenCalledWith('t1', false);
  });

  it('lets a MANAGER name their own team explicitly', async () => {
    const { svc, repo } = makeService();
    await svc.list(manager, true, 't1');
    expect(repo.listByTeam).toHaveBeenCalledWith('t1', true);
  });
});

describe('ProjectsService.update — moving a project between teams', () => {
  const project = { id: 'p1', teamId: 't1', name: 'Apollo', color: null, archived: false };

  it('moves the project when an ADMIN asks', async () => {
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue(project),
      setTeam: vi.fn().mockResolvedValue({ ...project, teamId: OTHER }),
    });
    const out = await svc.update('p1', { teamId: OTHER }, admin);
    expect(repo.setTeam).toHaveBeenCalledWith('p1', OTHER, 'a1');
    expect(out.teamId).toBe(OTHER);
  });

  it('403s a MANAGER trying to move one, even out of their own team', async () => {
    const { svc, repo } = makeService({ findForActor: vi.fn().mockResolvedValue(project) });
    await expect(svc.update('p1', { teamId: OTHER }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setTeam).not.toHaveBeenCalled();
  });

  it('treats a move to the current team as a no-op rather than an audited move', async () => {
    const { svc, repo } = makeService({ findForActor: vi.fn().mockResolvedValue(project) });
    await svc.update('p1', { teamId: 't1' }, admin);
    expect(repo.setTeam).not.toHaveBeenCalled();
  });

  it('lets an ADMIN administer a project outside their own team', async () => {
    // The un-stranding case: the admin moved themselves to t2, the project stayed in t1.
    // Before, this 403'd and the project could not be recovered through any surface.
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ ...project, teamId: 't1' }),
      setArchived: vi.fn().mockResolvedValue({ ...project, archived: true }),
    });
    await svc.update('p1', { archived: true }, { id: 'a1', role: 'ADMIN', teamId: OTHER });
    expect(repo.setArchived).toHaveBeenCalledWith('p1', true, 'a1');
  });

  it('still 403s a MANAGER administering another team’s project', async () => {
    const { svc } = makeService({
      findForActor: vi.fn().mockResolvedValue({ ...project, teamId: OTHER }),
    });
    await expect(svc.update('p1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s before any authorization decision when the project is gone', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.update('nope', { teamId: OTHER }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
