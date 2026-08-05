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

describe('ActivityController.ingest', () => {
  it('delegates the batch to the service with the current user', async () => {
    const service = {
      ingest: vi.fn().mockResolvedValue({ accepted: 2 }),
    } as unknown as ActivityService;
    const ctrl = new ActivityController(service);
    const batch = { samples: [] } as never;
    await ctrl.ingest(batch, user);
    expect(service.ingest).toHaveBeenCalledWith(batch, user);
  });

  it('returns 201, not 202 — the shipped Mac client classifies only 200/201 as success', () => {
    // '__httpCode__' is NestJS's @HttpCode metadata key. 202 Accepted made the client's
    // TimeEntryUploader.classify() treat every accepted batch as transient (see that Swift test),
    // wedging the activity-sample buffer. Must stay a 2xx the shipped client accepts.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const code = Reflect.getMetadata('__httpCode__', ActivityController.prototype.ingest);
    expect(code).toBe(201);
  });
});
