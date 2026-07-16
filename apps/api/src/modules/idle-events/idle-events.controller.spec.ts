import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { IdleEventsController } from './idle-events.controller.js';
import type { IdleEventsService } from './idle-events.service.js';
import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';
import { RESOURCE_SCOPE } from '../../common/decorators/resource-scope.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { IdleEvent } from '@timetrack/contracts';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const event: IdleEvent = {
  id: '019797a0-0000-7000-8000-000000000001',
  startTime: '2026-07-11T09:00:00Z',
  endTime: '2026-07-11T09:05:00Z',
  resolvedAction: 'KEPT',
};

describe('IdleEventsController', () => {
  it('delegates ingest to the service with the event and current user', async () => {
    const service = {
      ingest: vi.fn().mockResolvedValue({ id: event.id, resolvedAction: 'KEPT' }),
    } as unknown as IdleEventsService;
    const ctrl = new IdleEventsController(service);

    const result = await ctrl.ingest(event, user);

    expect(service.ingest).toHaveBeenCalledWith(event, user);
    expect(result).toEqual({ id: event.id, resolvedAction: 'KEPT' });
  });

  it('is NOT @Public — the global JwtAuthGuard applies (401 when unauthenticated)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(IS_PUBLIC, IdleEventsController.prototype.ingest);
    expect(meta).toBeUndefined();
  });
});

const listQuery = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

describe('IdleEventsController.list', () => {
  it('delegates list to the service with the query and current user', async () => {
    const service = {
      ingest: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as IdleEventsService;
    const ctrl = new IdleEventsController(service);
    await ctrl.list(listQuery, user);
    expect(service.list).toHaveBeenCalledWith(listQuery, user);
  });

  it('is @ResourceScope on ?userId= so the ResourceGuard enforces self/team/admin', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(RESOURCE_SCOPE, IdleEventsController.prototype.list);
    expect(meta).toEqual({ source: 'query', key: 'userId' });
  });
});
