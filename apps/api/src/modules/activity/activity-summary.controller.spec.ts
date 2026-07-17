import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { ActivitySummaryController } from './activity-summary.controller.js';
import type { ActivityService } from './activity.service.js';
import { RESOURCE_SCOPE } from '../../common/decorators/resource-scope.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const query = { from: '2026-07-01', to: '2026-07-31' };

describe('ActivitySummaryController.list', () => {
  it('delegates to service.listSummaries with the query and current user', async () => {
    const service = { listSummaries: vi.fn().mockResolvedValue([]) } as unknown as ActivityService;
    const ctrl = new ActivitySummaryController(service);
    await ctrl.list(query, user);
    expect(service.listSummaries).toHaveBeenCalledWith(query, user);
  });

  it('is @ResourceScope on ?userId= so the ResourceGuard enforces self/team/admin', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(RESOURCE_SCOPE, ActivitySummaryController.prototype.list);
    expect(meta).toEqual({ source: 'query', key: 'userId' });
  });
});
