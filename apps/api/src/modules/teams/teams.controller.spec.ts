import { describe, it, expect, vi } from 'vitest';
import { TeamsController } from './teams.controller.js';
import type { TeamsService } from './teams.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };

describe('TeamsController', () => {
  it('current delegates to getMine with the current user', async () => {
    const service = {
      getMine: vi.fn().mockResolvedValue({ id: 't1', name: 'Eng' }),
    } as unknown as TeamsService;
    const ctrl = new TeamsController(service);

    await ctrl.current(user);
    expect(service.getMine).toHaveBeenCalledWith(user);
  });
});
