import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { IdleEventsController } from './idle-events.controller.js';
import type { IdleEventsService } from './idle-events.service.js';
import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';
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
