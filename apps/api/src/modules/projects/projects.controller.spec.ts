import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectsController } from './projects.controller.js';
import type { ProjectsService } from './projects.service.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function make(overrides: Partial<ProjectsService> = {}) {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    bulkCreate: vi.fn(),
    createTask: vi.fn(),
    update: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    updateTask: vi.fn(),
    createSubproject: vi.fn(),
    updateSubproject: vi.fn(),
    listSubprojects: vi.fn(),
    topApps: vi.fn(),
    ...overrides,
  } as unknown as ProjectsService;
  return { ctrl: new ProjectsController(service), service };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectsController role-gating', () => {
  it.each([
    'createProject',
    'createTask',
    'update',
    'updateTask',
    'listTasks',
    'createSubproject',
    'updateSubproject',
    'listSubprojects',
    'topApps',
  ] as const)('gates %s to MANAGER/ADMIN', (handler) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype[handler]);
    expect(meta).toEqual(['MANAGER', 'ADMIN']);
  });

  it('does not role-gate list (any authenticated team member)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype.list);
    expect(meta).toBeUndefined();
  });
});

describe('ProjectsController delegation', () => {
  it('list passes the parsed includeArchived flag to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.list(actor, { includeArchived: true, allTeams: false });
    expect(service.list).toHaveBeenCalledWith(actor, true, undefined, false);
  });

  it('list forwards an explicit teamId so an ADMIN can read another team', async () => {
    const { ctrl, service } = make();
    await ctrl.list(actor, { includeArchived: false, allTeams: false, teamId: 't2' });
    expect(service.list).toHaveBeenCalledWith(actor, false, 't2', false);
  });

  it('list forwards allTeams so an ADMIN can read every team in one call', async () => {
    const { ctrl, service } = make();
    await ctrl.list(actor, { includeArchived: true, allTeams: true });
    expect(service.list).toHaveBeenCalledWith(actor, true, undefined, true);
  });

  it('update passes id, dto, and actor to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.update('p1', { archived: true }, actor);
    expect(service.update).toHaveBeenCalledWith('p1', { archived: true }, actor);
  });

  it('updateTask passes id, dto, and actor to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.updateTask('t1', { archived: true }, actor);
    expect(service.updateTask).toHaveBeenCalledWith('t1', { archived: true }, actor);
  });

  it('createSubproject passes dto and actor to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.createSubproject({ projectId: 'p1', name: 'X' }, actor);
    expect(service.createSubproject).toHaveBeenCalledWith({ projectId: 'p1', name: 'X' }, actor);
  });

  it('updateSubproject passes id, dto, and actor to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.updateSubproject('s1', { archived: true }, actor);
    expect(service.updateSubproject).toHaveBeenCalledWith('s1', { archived: true }, actor);
  });

  it('listSubprojects passes id and user to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.listSubprojects('p1', actor);
    expect(service.listSubprojects).toHaveBeenCalledWith('p1', actor);
  });

  it('listTasks passes id and user to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.listTasks('p1', actor);
    expect(service.listTasks).toHaveBeenCalledWith('p1', actor);
  });

  it('topApps passes id, query, and user to the service', async () => {
    const { ctrl, service } = make();
    const query = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' };
    await ctrl.topApps('p1', query, actor);
    expect(service.topApps).toHaveBeenCalledWith('p1', query, actor);
  });
});

describe('ProjectsController.bulkCreate authorization', () => {
  const ctx = (user: SessionUser): ExecutionContext =>
    ({
      getHandler: () => ProjectsController.prototype.bulkCreate,
      getClass: () => ProjectsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('is ADMIN-only (not MANAGER): importing clients spans the org', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype.bulkCreate);
    expect(meta).toEqual(['ADMIN']);
  });

  it('403s MANAGER and EMPLOYEE through the real RolesGuard', () => {
    const guard = new RolesGuard(new Reflector());
    for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
      expect(() => guard.canActivate(ctx({ id: 'u1', role, teamId: 't1' }))).toThrow(
        ForbiddenException,
      );
    }
    expect(guard.canActivate(ctx({ id: 'a1', role: 'ADMIN', teamId: 't1' }))).toBe(true);
  });

  it('passes the dto and actor to the service', async () => {
    const { ctrl, service } = make();
    const dto = { teamId: '01920000-0000-7000-8000-0000000000c1', names: ['Acme'] };
    await ctrl.bulkCreate(dto, actor);
    expect(service.bulkCreate).toHaveBeenCalledWith(dto, actor);
  });
});
