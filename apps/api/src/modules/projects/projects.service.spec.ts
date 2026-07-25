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
    listTasksForProject: vi.fn(),
    findTaskForActor: vi.fn(),
    setTaskArchived: vi.fn(),
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
