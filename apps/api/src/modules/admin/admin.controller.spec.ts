import { describe, it, expect, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const service = {
    listAudit: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn().mockResolvedValue({}),
    eraseUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as AdminService;
  return { service, ctrl: new AdminController(service) };
}

describe('AdminController', () => {
  it('auditLog delegates the query', async () => {
    const { ctrl, service } = make();
    const query = { targetType: 'USER' };
    await ctrl.auditLog(query);
    expect(service.listAudit).toHaveBeenCalledWith(query);
  });

  it('updateSettings delegates the patch + actor', async () => {
    const { ctrl, service } = make();
    const patch = { screenshotIntervalMinutes: 10 };
    await ctrl.updateSettings(patch, actor);
    expect(service.updateSettings).toHaveBeenCalledWith(patch, actor);
  });

  it('eraseUser delegates id + dto + actor', async () => {
    const { ctrl, service } = make();
    const dto = { reason: 'GDPR request' };
    await ctrl.eraseUser('u1', dto, actor);
    expect(service.eraseUser).toHaveBeenCalledWith('u1', dto, actor);
  });
});
