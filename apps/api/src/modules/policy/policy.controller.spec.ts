import { describe, it, expect, vi } from 'vitest';
import { PolicyController } from './policy.controller.js';
import type { PolicyService } from './policy.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };

describe('PolicyController', () => {
  it('effective delegates to the service with the current user', async () => {
    const service = {
      effective: vi.fn().mockResolvedValue({ ackRequired: true, policyVersion: 1 }),
    } as unknown as PolicyService;
    const ctrl = new PolicyController(service);

    await ctrl.effective(user);
    expect(service.effective).toHaveBeenCalledWith(user);
  });
});
