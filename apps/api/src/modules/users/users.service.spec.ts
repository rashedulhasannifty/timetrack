import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock factory can safely reference this shared, mutable holder
// (a plain top-level const would be in the TDZ when the hoisted factory runs).
const { nodeEnv } = vi.hoisted(() => ({ nodeEnv: { value: 'development' } }));
vi.mock('@timetrack/config', () => ({ loadEnv: () => ({ NODE_ENV: nodeEnv.value }) }));

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import type { UsersRepository } from './users.repository.js';
import type { InvitesService } from '../invites/invites.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { User } from '@timetrack/contracts';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const dto = { email: 'new@ex.co', name: 'New', role: 'EMPLOYEE' as const, teamId: 't1' };
const created = {
  invite: {
    id: 'inv1',
    email: 'new@ex.co',
    role: 'EMPLOYEE' as const,
    teamId: 't1',
    expiresAt: new Date('2026-07-15T00:00:00Z'),
  },
  token: 'secret-token',
};

function makeService() {
  const repo = {} as unknown as UsersRepository;
  const invites = { create: vi.fn().mockResolvedValue(created) } as unknown as InvitesService;
  return { svc: new UsersService(repo, invites) };
}

beforeEach(() => vi.clearAllMocks());

describe('UsersService.invite devToken gating', () => {
  it('includes devToken in development', async () => {
    nodeEnv.value = 'development';
    const { svc } = makeService();
    const result = await svc.invite(dto, admin);
    expect(result.devToken).toBe('secret-token');
    expect(result.invite.expiresAt).toBe('2026-07-15T00:00:00.000Z');
  });

  it('omits devToken outside development', async () => {
    nodeEnv.value = 'production';
    const { svc } = makeService();
    const result = await svc.invite(dto, admin);
    expect(result.devToken).toBeUndefined();
  });
});

const activeEmployee = { id: 'u2', role: 'EMPLOYEE' as const, teamId: 't1', deactivatedAt: null };

function makeSetActiveService(repoOverrides: Partial<UsersRepository>) {
  const repo = {
    findForAdmin: vi.fn(),
    findUser: vi.fn(),
    setActive: vi.fn(),
    setRole: vi.fn(),
    ackMonitoring: vi.fn(),
    ...repoOverrides,
  } as unknown as UsersRepository;
  const invites = {} as unknown as InvitesService;
  return { svc: new UsersService(repo, invites), repo };
}

describe('UsersService.update — active-state guards', () => {
  it('404 when the target does not exist', async () => {
    const { svc } = makeSetActiveService({ findForAdmin: vi.fn().mockResolvedValue(null) });
    await expect(svc.update('nope', { deactivated: true }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 when the target is on another team', async () => {
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue({ ...activeEmployee, teamId: 'other' }),
    });
    await expect(svc.update('u2', { deactivated: true }, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('409 when an admin deactivates their own account', async () => {
    const { svc } = makeSetActiveService({
      findForAdmin: vi
        .fn()
        .mockResolvedValue({ id: 'a1', role: 'ADMIN', teamId: 't1', deactivatedAt: null }),
    });
    await expect(svc.update('a1', { deactivated: true }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409 when deactivating the last active admin', async () => {
    const { svc } = makeSetActiveService({
      findForAdmin: vi
        .fn()
        .mockResolvedValue({ id: 'u2', role: 'ADMIN', teamId: 't1', deactivatedAt: null }),
      setActive: vi.fn().mockResolvedValue({ status: 'LAST_ADMIN' }),
    });
    await expect(svc.update('u2', { deactivated: true }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deactivates another admin when others remain', async () => {
    const user = { id: 'u2' } as User;
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi
        .fn()
        .mockResolvedValue({ id: 'u2', role: 'ADMIN', teamId: 't1', deactivatedAt: null }),
      setActive: vi.fn().mockResolvedValue({ status: 'OK', user }),
    });
    await expect(svc.update('u2', { deactivated: true }, admin)).resolves.toBe(user);
    expect(repo.setActive).toHaveBeenCalledWith('u2', true, 'a1');
  });

  it('reactivate skips the lockout guards', async () => {
    const user = { id: 'u2' } as User;
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue({ ...activeEmployee, deactivatedAt: new Date() }),
      setActive: vi.fn().mockResolvedValue({ status: 'OK', user }),
    });
    await expect(svc.update('u2', { deactivated: false }, admin)).resolves.toBe(user);
    expect(repo.setActive).toHaveBeenCalledWith('u2', false, 'a1');
  });
});

describe('UsersService.update — role guards', () => {
  it('changes another user’s role when allowed', async () => {
    const user = { id: 'u2', role: 'MANAGER' } as User;
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      setRole: vi.fn().mockResolvedValue({ status: 'OK', user }),
    });
    await expect(svc.update('u2', { role: 'MANAGER' }, admin)).resolves.toBe(user);
    expect(repo.setRole).toHaveBeenCalledWith('u2', 'MANAGER', 'a1');
  });

  it('is a no-op (no setRole, no audit) when the role is unchanged', async () => {
    const user = { id: 'u2', role: 'EMPLOYEE' } as User;
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      findUser: vi.fn().mockResolvedValue(user),
    });
    await expect(svc.update('u2', { role: 'EMPLOYEE' }, admin)).resolves.toBe(user);
    expect(repo.setRole).not.toHaveBeenCalled();
  });

  it('409 when an admin demotes their OWN role (self-lockout)', async () => {
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi
        .fn()
        .mockResolvedValue({ id: 'a1', role: 'ADMIN', teamId: 't1', deactivatedAt: null }),
    });
    await expect(svc.update('a1', { role: 'EMPLOYEE' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.setRole).not.toHaveBeenCalled();
  });

  it('409 when demoting the last active admin', async () => {
    const { svc } = makeSetActiveService({
      findForAdmin: vi
        .fn()
        .mockResolvedValue({ id: 'u2', role: 'ADMIN', teamId: 't1', deactivatedAt: null }),
      setRole: vi.fn().mockResolvedValue({ status: 'LAST_ADMIN' }),
    });
    await expect(svc.update('u2', { role: 'EMPLOYEE' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('403 when the target is on another team', async () => {
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue({ ...activeEmployee, teamId: 'other' }),
    });
    await expect(svc.update('u2', { role: 'MANAGER' }, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('UsersService.ackMonitoring', () => {
  it('403 when acknowledging for another user (no admin override)', async () => {
    const { svc } = makeSetActiveService({});
    await expect(
      svc.ackMonitoring('someone-else', { policyVersion: 'v1' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes for yourself and returns the updated user', async () => {
    const user = { id: 'a1' } as User;
    const ackMonitoring = vi.fn().mockResolvedValue(user);
    const { svc } = makeSetActiveService({ ackMonitoring });
    await expect(svc.ackMonitoring('a1', { policyVersion: 'v1' }, admin)).resolves.toBe(user);
    expect(ackMonitoring).toHaveBeenCalledWith('a1', 'v1', 'a1');
  });
});
