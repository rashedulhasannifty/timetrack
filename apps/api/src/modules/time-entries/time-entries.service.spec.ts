import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service.js';
import type { TimeEntriesRepository } from './time-entries.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

function repoStub(overrides: Partial<TimeEntriesRepository> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    isInTeam: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as TimeEntriesRepository;
}

describe('TimeEntriesService.list authorization', () => {
  it('lets an employee read their own entries', async () => {
    const svc = new TimeEntriesService(repoStub());
    await expect(svc.list({ ...query, userId: 'u1' }, employee)).resolves.toEqual([]);
  });

  // The 403 case is the one that matters. Test it, not just the happy path.
  it('forbids an employee reading someone else', async () => {
    const svc = new TimeEntriesService(repoStub());
    await expect(svc.list({ ...query, userId: 'u2' }, employee)).rejects.toThrow(ForbiddenException);
  });

  it('forbids a manager reading outside their team', async () => {
    const svc = new TimeEntriesService(repoStub({ isInTeam: vi.fn().mockResolvedValue(false) }));
    await expect(svc.list({ ...query, userId: 'u9' }, manager)).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager read inside their team', async () => {
    const svc = new TimeEntriesService(repoStub({ isInTeam: vi.fn().mockResolvedValue(true) }));
    await expect(svc.list({ ...query, userId: 'u2' }, manager)).resolves.toEqual([]);
  });
});
