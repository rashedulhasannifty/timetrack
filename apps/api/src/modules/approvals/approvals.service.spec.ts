import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service.js';
import type { ApprovalsRepository } from './approvals.repository.js';
import type { ResourceAccessService } from '../../common/authz/resource-access.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };

function make() {
  const repo = {
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    periodTrackedSeconds: vi.fn().mockResolvedValue(5400),
    decide: vi.fn().mockResolvedValue({ id: 'ts1', status: 'APPROVED' }),
  } as unknown as ApprovalsRepository;
  const access = {
    assertCanAccessUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResourceAccessService;
  return { svc: new ApprovalsService(repo, access), repo, access };
}

describe('ApprovalsService.list', () => {
  it('scopes an EMPLOYEE to themselves', async () => {
    const { svc, repo } = make();
    await svc.list({}, employee);
    expect(repo.list).toHaveBeenCalledWith({ kind: 'user', userId: 'u1' }, undefined);
  });
  it('scopes a MANAGER to their own team', async () => {
    const { svc, repo } = make();
    await svc.list({ status: 'PENDING' }, manager);
    expect(repo.list).toHaveBeenCalledWith({ kind: 'team', teamId: 't1' }, 'PENDING');
  });
  it('403s a MANAGER requesting another team', async () => {
    const { svc, repo } = make();
    await expect(svc.list({ teamId: 't2' }, manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.list).not.toHaveBeenCalled();
  });
  it('ADMIN with no filter → all; with teamId → that team', async () => {
    const { svc, repo } = make();
    await svc.list({}, admin);
    expect(repo.list).toHaveBeenCalledWith({ kind: 'all' }, undefined);
    await svc.list({ teamId: 't9' }, admin);
    expect(repo.list).toHaveBeenCalledWith({ kind: 'team', teamId: 't9' }, undefined);
  });
});

describe('ApprovalsService.decide', () => {
  it('404s when the timesheet does not exist', async () => {
    const { svc, repo } = make();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(svc.decide('nope', { status: 'APPROVED' }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('403s (and does not decide) when the actor cannot access the user', async () => {
    const { svc, repo, access } = make();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ts1',
      userId: 'u9',
      periodStart: new Date('2026-06-29Z'),
      periodEnd: new Date('2026-07-06Z'),
      status: 'PENDING',
    });
    (access.assertCanAccessUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(svc.decide('ts1', { status: 'APPROVED' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.decide).not.toHaveBeenCalled();
  });
  it('snapshots trackedSeconds and passes prevStatus to the repo', async () => {
    const { svc, repo } = make();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ts1',
      userId: 'u9',
      periodStart: new Date('2026-06-29T00:00:00Z'),
      periodEnd: new Date('2026-07-06T00:00:00Z'),
      status: 'PENDING',
    });
    await svc.decide('ts1', { status: 'FLAGGED', note: 'redo' }, manager);
    expect(repo.periodTrackedSeconds).toHaveBeenCalledWith(
      'u9',
      new Date('2026-06-29T00:00:00Z'),
      new Date('2026-07-06T00:00:00Z'),
    );
    expect(repo.decide).toHaveBeenCalledWith('ts1', {
      status: 'FLAGGED',
      note: 'redo',
      reviewerId: 'm1',
      totalSeconds: 5400,
      prevStatus: 'PENDING',
    });
  });
});
