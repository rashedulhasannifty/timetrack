import { describe, it, expect, vi } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service.js';
import type { TimeEntriesRepository } from './time-entries.repository.js';
import type { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { TimeEntry } from '@timetrack/contracts';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const query = { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z' };

const existing: TimeEntry = {
  id: 'e1',
  userId: 'u1',
  projectId: null,
  taskId: null,
  startTime: '2026-07-11T09:00:00Z',
  endTime: '2026-07-11T10:00:00Z',
  source: 'MANUAL',
  note: undefined,
  editedById: null,
  editedAt: null,
};

function repoStub(overrides: Partial<TimeEntriesRepository> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ id: 'e1' }),
    findForEdit: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockImplementation((id: string) => Promise.resolve({ ...existing, id })),
    findActiveByUser: vi.fn().mockResolvedValue(null),
    hasOverlap: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as TimeEntriesRepository;
}

function accessStub(overrides: Partial<ResourceAccessService> = {}) {
  return {
    assertCanAccessUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ResourceAccessService;
}

describe('TimeEntriesService', () => {
  it('lists the target user (defaulting to self when no userId is given)', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.list(query, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u1' });
  });

  it('lists an explicitly requested user id', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.list({ ...query, userId: 'u2' }, employee);
    expect(repo.list).toHaveBeenCalledWith({ ...query, userId: 'u2' });
  });

  it('attributes an upsert to the authenticated user', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
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

  it('edit authorizes against the FETCHED entry owner, then updates with a changed-only diff', async () => {
    const repo = repoStub();
    const access = accessStub();
    const svc = new TimeEntriesService(repo, access);

    await svc.edit('e1', { note: 'fixed note' }, { id: 'mgr', role: 'MANAGER', teamId: 't1' });

    // Authorization is checked against the entry's userId, not the requester's.
    expect(access.assertCanAccessUser).toHaveBeenCalledWith(
      { id: 'mgr', role: 'MANAGER', teamId: 't1' },
      'u1',
    );
    // Only the changed field appears in after/before.
    expect(repo.update).toHaveBeenCalledWith('e1', { note: 'fixed note' }, { note: null }, 'mgr');
  });

  it('edit throws 404 when the entry does not exist (and never checks access)', async () => {
    const repo = repoStub({ findForEdit: vi.fn().mockResolvedValue(null) });
    const access = accessStub();
    const svc = new TimeEntriesService(repo, access);
    await expect(svc.edit('missing', { note: 'x' }, employee)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(access.assertCanAccessUser).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('edit propagates a 403 from the access service and does not update', async () => {
    const repo = repoStub();
    const access = accessStub({
      assertCanAccessUser: vi.fn().mockRejectedValue(new ForbiddenException()),
    });
    const svc = new TimeEntriesService(repo, access);
    await expect(
      svc.edit('e1', { note: 'x' }, { id: 'other', role: 'EMPLOYEE', teamId: 't9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('edit throws 422 when no field actually changes (empty or no-op patch)', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    // endTime equals the existing value -> nothing changed.
    await expect(
      svc.edit('e1', { endTime: '2026-07-11T10:00:00Z' }, employee),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(svc.edit('e1', {}, employee)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Regression (C4): the API accepted an entry that cannot represent real work. A patch moving
  // ONE edge past a stored one is invisible to the schema, which only ever sees the patch.
  it('edit throws 422 when a patched edge inverts the entry against the stored one', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    // stored: 09:00 -> 10:00. Moving only the start past the stored end inverts it.
    await expect(
      svc.edit('e1', { startTime: '2026-07-11T11:00:00Z' }, employee),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('edit accepts a zero-length entry (the recovery Discard marker)', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.edit('e1', { endTime: '2026-07-11T09:00:00Z' }, employee);
    expect(repo.update).toHaveBeenCalled();
  });

  it('edit throws 422 when the result would overlap another entry for the same user', async () => {
    const repo = repoStub({ hasOverlap: vi.fn().mockResolvedValue(true) });
    const svc = new TimeEntriesService(repo, accessStub());
    await expect(
      svc.edit('e1', { endTime: '2026-07-11T12:00:00Z' }, employee),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('edit does not overlap-check an entry left open (the index governs that)', async () => {
    const repo = repoStub({ hasOverlap: vi.fn().mockResolvedValue(true) });
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.edit('e1', { endTime: null }, employee);
    expect(repo.hasOverlap).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });

  it('findActive delegates to the repository', async () => {
    const repo = repoStub({ findActiveByUser: vi.fn().mockResolvedValue(existing) });
    const svc = new TimeEntriesService(repo, accessStub());
    expect(await svc.findActive('u1')).toEqual(existing);
    expect(repo.findActiveByUser).toHaveBeenCalledWith('u1');
  });
});
