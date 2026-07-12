import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { ProjectsController } from './projects.controller.js';
import type { ProjectsService } from './projects.service.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };

function make(overrides: Partial<ProjectsService> = {}) {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    createTask: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as unknown as ProjectsService;
  return { ctrl: new ProjectsController(service), service };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectsController role-gating', () => {
  it.each(['createProject', 'createTask', 'archive'] as const)(
    'gates %s to MANAGER/ADMIN',
    (handler) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype[handler]);
      expect(meta).toEqual(['MANAGER', 'ADMIN']);
    },
  );

  it('does not role-gate list (any authenticated team member)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype.list);
    expect(meta).toBeUndefined();
  });
});

describe('ProjectsController delegation', () => {
  it('list passes the parsed includeArchived flag to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.list(actor, { includeArchived: true });
    expect(service.list).toHaveBeenCalledWith(actor, true);
  });

  it('archive passes id, dto, and actor to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.archive('p1', { archived: true }, actor);
    expect(service.archive).toHaveBeenCalledWith('p1', { archived: true }, actor);
  });
});
