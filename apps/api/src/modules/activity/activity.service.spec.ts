import { describe, it, expect, vi } from 'vitest';
import { ActivityService } from './activity.service.js';
import type { ActivityRepository } from './activity.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

function repoStub() {
  return {
    insertBatch: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue([]),
    listSummaries: vi.fn().mockResolvedValue([]),
  } as unknown as ActivityRepository;
}

describe('ActivityService.list', () => {
  it('lists the target user, defaulting to self when no userId is given', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo);
    await svc.list(query, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u1' });
  });

  it('lists an explicitly requested user id (guard already authorized it)', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo);
    await svc.list({ ...query, userId: 'u2' }, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u2' });
  });
});

const summaryQuery = { from: '2026-07-01', to: '2026-07-31' };

describe('ActivityService.listSummaries', () => {
  it('lists the target user, defaulting to self when no userId is given', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo);
    await svc.listSummaries(summaryQuery, employee);
    expect(repo.listSummaries).toHaveBeenCalledWith({
      userId: 'u1',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('lists an explicitly requested user id (guard already authorized it)', async () => {
    const repo = repoStub();
    const svc = new ActivityService(repo);
    await svc.listSummaries({ ...summaryQuery, userId: 'u2' }, employee);
    expect(repo.listSummaries).toHaveBeenCalledWith({
      userId: 'u2',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });
});
