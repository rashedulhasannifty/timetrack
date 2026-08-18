import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { TeamsController } from './teams.controller.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import type { TeamsService } from './teams.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const service = {
    getMine: vi.fn().mockResolvedValue({ id: 't1', name: 'Eng' }),
    list: vi.fn().mockResolvedValue([{ id: 't1', name: 'Eng' }]),
    create: vi.fn().mockResolvedValue({ id: 't2', name: 'Support' }),
    rename: vi.fn().mockResolvedValue({ id: 't2', name: 'Customer Support' }),
  } as unknown as TeamsService;
  return { service, ctrl: new TeamsController(service) };
}

describe('TeamsController', () => {
  it('current delegates to getMine with the current user', async () => {
    const { ctrl, service } = make();
    await ctrl.current(user);
    expect(service.getMine).toHaveBeenCalledWith(user);
  });

  it('list delegates to the service', async () => {
    const { ctrl, service } = make();
    await ctrl.list();
    expect(service.list).toHaveBeenCalledOnce();
  });

  it('create delegates dto + actor', async () => {
    const { ctrl, service } = make();
    const dto = { name: 'Support' };
    await ctrl.create(dto, admin);
    expect(service.create).toHaveBeenCalledWith(dto, admin);
  });

  it('rename passes the URL team id, not the actor’s own team', async () => {
    const { ctrl, service } = make();
    const dto = { name: 'Customer Support' };
    // The admin is in t1; the team being renamed is t2. Reading the id from the actor here
    // would silently rename the wrong team.
    await ctrl.rename('t2', dto, admin);
    expect(service.rename).toHaveBeenCalledWith('t2', dto, admin);
  });
});

/**
 * The 403 itself is produced by the RolesGuard, so what must be pinned here is the metadata
 * that guard reads. `Roles` is `SetMetadata`, which does NOT depend on the
 * emitDecoratorMetadata output vitest drops, so this reflects reliably.
 *
 * It matters more than usual on this controller: the team list is the roster of management
 * boundaries, and leaking it to a MANAGER would hand them every other team's name and
 * monitoring policy.
 */
describe('TeamsController authorization metadata', () => {
  const rolesFor = (handler: object): unknown => Reflect.getMetadata(ROLES, handler);

  it('restricts the team list to ADMIN', () => {
    expect(rolesFor(TeamsController.prototype.list)).toEqual(['ADMIN']);
  });

  it('restricts team creation to ADMIN', () => {
    expect(rolesFor(TeamsController.prototype.create)).toEqual(['ADMIN']);
  });

  it('restricts renaming a team to ADMIN', () => {
    expect(rolesFor(TeamsController.prototype.rename)).toEqual(['ADMIN']);
  });

  it('leaves GET /teams/current open to any authenticated user', () => {
    // Every user needs their own team's policy; the global JwtAuthGuard still applies.
    expect(rolesFor(TeamsController.prototype.current)).toBeUndefined();
  });
});
