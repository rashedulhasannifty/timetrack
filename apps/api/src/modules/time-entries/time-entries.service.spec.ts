import { describe, it, expect, vi } from 'vitest';
import { TimeEntriesService } from './time-entries.service.js';
import type { TimeEntriesRepository } from './time-entries.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

function repoStub(overrides: Partial<TimeEntriesRepository> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ id: 'e1' }),
    ...overrides,
  } as unknown as TimeEntriesRepository;
}

// Authorization is enforced by @ResourceScope + ResourceGuard (see
// resource-access.service.spec). The service just resolves the target and delegates.
describe('TimeEntriesService', () => {
  it('lists the target user (defaulting to self when no userId is given)', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo);
    await svc.list(query, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u1' });
  });

  it('lists an explicitly requested user id', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo);
    await svc.list({ ...query, userId: 'u2' }, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u2' });
  });

  it('attributes an upsert to the authenticated user', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo);
    const dto = {
      id: '019797a0-0000-7000-8000-000000000001',
      projectId: null,
      taskId: null,
      startTime: '2026-07-11T09:00:00Z',
      endTime: null,
      source: 'MANUAL' as const,
    };
    await svc.upsert(dto, employee);
    expect(repo.upsert).toHaveBeenCalledWith(dto, 'u1');
  });
});
