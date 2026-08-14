import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock factory can safely reference this shared, mutable holder
// (a plain top-level const would be in the TDZ when the hoisted factory runs).
const { nodeEnv } = vi.hoisted(() => ({ nodeEnv: { value: 'development' } }));
vi.mock('@timetrack/config', () => ({ loadEnv: () => ({ NODE_ENV: nodeEnv.value }) }));

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
    setTeam: vi.fn(),
    teamExists: vi.fn().mockResolvedValue(true),
    listAll: vi.fn(),
    listByTeam: vi.fn(),
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

  it('acts on a target in another team — an ADMIN is org-wide, not team-scoped', async () => {
    // Was a 403. Teams are the unit of management, so a team-scoped admin could never manage a
    // second team's people; MANAGER scope is unchanged and still strictly own-team.
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue({ ...activeEmployee, teamId: 'other' }),
      setActive: vi.fn().mockResolvedValue({ status: 'OK', user: {} as User }),
    });
    await expect(svc.update('u2', { deactivated: true }, admin)).resolves.toBeDefined();
    expect(repo.setActive).toHaveBeenCalledWith('u2', true, 'a1');
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

  it('promotes a target in another team — an ADMIN is org-wide, not team-scoped', async () => {
    const { svc, repo } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue({ ...activeEmployee, teamId: 'other' }),
      setRole: vi.fn().mockResolvedValue({ status: 'OK', user: {} as User }),
    });
    await expect(svc.update('u2', { role: 'MANAGER' }, admin)).resolves.toBeDefined();
    expect(repo.setRole).toHaveBeenCalledWith('u2', 'MANAGER', 'a1');
  });
});

describe('UsersService.me', () => {
  it('returns the caller’s own user', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.co',
      name: 'Ann Lee',
      role: 'EMPLOYEE',
    } as unknown as User;
    const { svc, repo } = makeSetActiveService({ findUser: vi.fn().mockResolvedValue(user) });
    await expect(svc.me({ id: 'u1', role: 'EMPLOYEE', teamId: 't1' })).resolves.toBe(user);
    expect(repo.findUser).toHaveBeenCalledWith('u1');
  });

  it('throws NotFound when the record is missing', async () => {
    const { svc } = makeSetActiveService({ findUser: vi.fn().mockResolvedValue(null) });
    await expect(svc.me({ id: 'x', role: 'EMPLOYEE', teamId: 't1' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('UsersService.update — team assignment', () => {
  // Moving a user's team IS assigning them to a different manager: a MANAGER manages their own
  // team, so this is a permissions change and every path below is about not doing it by accident.
  it('moves the user and passes the actor through for the audit row', async () => {
    const moved = { id: 'u2', teamId: 't2' } as User;
    const setTeam = vi.fn().mockResolvedValue(moved);
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      setTeam,
    });
    await expect(svc.update('u2', { teamId: 't2' }, admin)).resolves.toBe(moved);
    expect(setTeam).toHaveBeenCalledWith('u2', 't2', 'a1');
  });

  it('422 on an unknown destination team, without touching the user', async () => {
    const setTeam = vi.fn();
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      teamExists: vi.fn().mockResolvedValue(false),
      setTeam,
    });
    await expect(svc.update('u2', { teamId: 'ghost' }, admin)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(setTeam).not.toHaveBeenCalled();
  });

  it('writes nothing when the user is already on that team', async () => {
    // A no-op must not emit an audit row — the log is the record that a visibility boundary
    // moved, and a row saying "moved from t1 to t1" makes it lie.
    const current = { id: 'u2', teamId: 't1' } as User;
    const setTeam = vi.fn();
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      findUser: vi.fn().mockResolvedValue(current),
      setTeam,
    });
    await expect(svc.update('u2', { teamId: 't1' }, admin)).resolves.toBe(current);
    expect(setTeam).not.toHaveBeenCalled();
  });

  it('applies a combined promote-and-move in role-then-team order', async () => {
    const promoted = { id: 'u2', role: 'MANAGER', teamId: 't1' } as User;
    const moved = { id: 'u2', role: 'MANAGER', teamId: 't2' } as User;
    const setRole = vi.fn().mockResolvedValue({ status: 'OK', user: promoted });
    const setTeam = vi.fn().mockResolvedValue(moved);
    const { svc } = makeSetActiveService({
      findForAdmin: vi.fn().mockResolvedValue(activeEmployee),
      setRole,
      setTeam,
    });
    // The final record must reflect BOTH changes, so the team result is the one returned.
    await expect(svc.update('u2', { role: 'MANAGER', teamId: 't2' }, admin)).resolves.toBe(moved);
    expect(setRole).toHaveBeenCalledBefore(setTeam);
  });
});

describe('UsersService.list scope', () => {
  it('gives an ADMIN the whole deployment', async () => {
    const listAll = vi.fn().mockResolvedValue([]);
    const listByTeam = vi.fn();
    const { svc } = makeSetActiveService({ listAll, listByTeam });
    await svc.list(admin);
    expect(listAll).toHaveBeenCalledOnce();
    expect(listByTeam).not.toHaveBeenCalled();
  });

  it('keeps a MANAGER to their own team', async () => {
    const listAll = vi.fn();
    const listByTeam = vi.fn().mockResolvedValue([]);
    const { svc } = makeSetActiveService({ listAll, listByTeam });
    await svc.list({ id: 'm1', role: 'MANAGER', teamId: 't9' });
    expect(listByTeam).toHaveBeenCalledWith('t9');
    expect(listAll).not.toHaveBeenCalled();
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
