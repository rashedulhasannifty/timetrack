import { describe, it, expect, vi } from 'vitest';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const service = {
    list: vi.fn().mockResolvedValue([{ id: 'u1' }]),
    setActive: vi.fn().mockResolvedValue({ id: 'u1' }),
    invite: vi.fn().mockResolvedValue({ id: 'u2', inviteToken: 'tok' }),
    ackMonitoring: vi.fn().mockResolvedValue({ id: 'u1' }),
  } as unknown as UsersService;
  return { service, ctrl: new UsersController(service) };
}

describe('UsersController', () => {
  it('list delegates with the current user', async () => {
    const { ctrl, service } = make();
    await ctrl.list(actor);
    expect(service.list).toHaveBeenCalledWith(actor);
  });

  it('update delegates id + dto + actor to setActive', async () => {
    const { ctrl, service } = make();
    const dto = { deactivated: true };
    await ctrl.update('u1', dto, actor);
    expect(service.setActive).toHaveBeenCalledWith('u1', dto, actor);
  });

  it('invite delegates dto + actor', async () => {
    const { ctrl, service } = make();
    const dto = {
      email: 'new@example.test',
      name: 'New User',
      role: 'EMPLOYEE' as const,
      teamId: 't1',
    };
    await ctrl.invite(dto, actor);
    expect(service.invite).toHaveBeenCalledWith(dto, actor);
  });

  it('ackMonitoring delegates id + dto + actor', async () => {
    const { ctrl, service } = make();
    const dto = { policyVersion: '1' };
    await ctrl.ackMonitoring('u1', dto, actor);
    expect(service.ackMonitoring).toHaveBeenCalledWith('u1', dto, actor);
  });
});
