import { describe, it, expect, vi } from 'vitest';
import { ClientsController } from './clients.controller.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import type { ClientsService } from './clients.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const actor: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

describe('ClientsController', () => {
  it('list delegates with the current user', async () => {
    const service = { list: vi.fn().mockResolvedValue([]) } as unknown as ClientsService;
    await new ClientsController(service).list(actor);
    expect(service.list).toHaveBeenCalledWith(actor);
  });

  // The 403 for a non-admin comes from RolesGuard, which reads this metadata.
  it('restricts the version list to ADMIN', () => {
    expect(Reflect.getMetadata(ROLES, ClientsController.prototype.list)).toEqual(['ADMIN']);
  });
});
