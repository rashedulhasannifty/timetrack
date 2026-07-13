import { describe, it, expect, vi } from 'vitest';
import { IdleEventsService } from './idle-events.service.js';
import type { IdleEventsRepository } from './idle-events.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { IdleEvent } from '@timetrack/contracts';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const event: IdleEvent = {
  id: '019797a0-0000-7000-8000-000000000001',
  startTime: '2026-07-11T09:00:00Z',
  endTime: '2026-07-11T09:05:00Z',
  resolvedAction: 'DISCARDED',
};

function repoStub() {
  return {
    upsert: vi.fn().mockResolvedValue({ id: event.id, resolvedAction: 'DISCARDED' }),
  } as unknown as IdleEventsRepository;
}

describe('IdleEventsService', () => {
  it('attributes an idle event to the authenticated user (no cross-user writes)', async () => {
    const repo = repoStub();
    const svc = new IdleEventsService(repo);
    const result = await svc.ingest(event, employee);
    expect(repo.upsert).toHaveBeenCalledWith(event, 'u1');
    expect(result).toEqual({ id: event.id, resolvedAction: 'DISCARDED' });
  });
});
