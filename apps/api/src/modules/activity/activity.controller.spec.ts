import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { ActivityController } from './activity.controller.js';
import type { ActivityService } from './activity.service.js';
import { RESOURCE_SCOPE } from '../../common/decorators/resource-scope.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

describe('ActivityController.list', () => {
  it('delegates list to the service with the query and current user', async () => {
    const service = { list: vi.fn().mockResolvedValue([]) } as unknown as ActivityService;
    const ctrl = new ActivityController(service);
    await ctrl.list(query, user);
    expect(service.list).toHaveBeenCalledWith(query, user);
  });

  it('is @ResourceScope on ?userId= so the ResourceGuard enforces self/team/admin', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(RESOURCE_SCOPE, ActivityController.prototype.list);
    expect(meta).toEqual({ source: 'query', key: 'userId' });
  });
});
