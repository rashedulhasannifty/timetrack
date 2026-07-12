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
    ...overrides,
  } as unknown as ProjectsRepository;
  return { svc: new ProjectsService(repo), repo };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectsService.createProject', () => {
  it('rejects creating a project for another team (403)', async () => {
    const { svc, repo } = makeService();
    await expect(svc.createProject({ teamId: 't2', name: 'X' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.createProject).not.toHaveBeenCalled();
  });

  it('creates when the team matches the actor', async () => {
    const created = { id: 'p1', teamId: 't1', name: 'X', archived: false };
    const { svc, repo } = makeService({
      createProject: vi.fn().mockResolvedValue(created),
    });
    await expect(svc.createProject({ teamId: 't1', name: 'X' }, manager)).resolves.toEqual(created);
    expect(repo.createProject).toHaveBeenCalledWith('t1', 'X', 'm1');
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

describe('ProjectsService.archive', () => {
  it("403 when archiving another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't2', archived: false }),
    });
    await expect(svc.archive('p1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setArchived).not.toHaveBeenCalled();
  });

  it('404 when the project does not exist', async () => {
    const { svc, repo } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.archive('p9', { archived: true }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.setArchived).not.toHaveBeenCalled();
  });

  it('sets archived with (id, archived, actorId) when the team matches', async () => {
    const updated = { id: 'p1', teamId: 't1', name: 'X', archived: true };
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1', archived: false }),
      setArchived: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.archive('p1', { archived: true }, manager)).resolves.toEqual(updated);
    expect(repo.setArchived).toHaveBeenCalledWith('p1', true, 'm1');
  });
});

describe('ProjectsService.list', () => {
  it('passes includeArchived through to the repo', async () => {
    const { svc, repo } = makeService({ listByTeam: vi.fn().mockResolvedValue([]) });
    await svc.list(manager, true);
    expect(repo.listByTeam).toHaveBeenCalledWith('t1', true);
  });
});
