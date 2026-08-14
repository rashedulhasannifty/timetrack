import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

vi.mock('argon2', () => ({ hash: vi.fn().mockResolvedValue('hashed'), argon2id: 2 }));

// The service reads INVITE_TTL_DAYS at construction; unit tests must not depend on a real
// environment (CI sets only DATABASE_URL/REDIS_URL).
const ttlDays = { value: 7 };
vi.mock('@timetrack/config', () => ({ loadEnv: () => ({ INVITE_TTL_DAYS: ttlDays.value }) }));

import { InvitesService } from './invites.service.js';
import type { InvitesRepository } from './invites.repository.js';
import type { QueueService } from '../../infra/queue/queue.module.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const admin: SessionUser = { id: 'admin1', role: 'ADMIN', teamId: 'team1' };
const dto = { email: 'new@ex.co', name: 'New Hire', role: 'EMPLOYEE' as const, teamId: 'team1' };

function makeService(repo: Partial<InvitesRepository> = {}) {
  const fullRepo = {
    createInvite: vi
      .fn()
      .mockResolvedValue({ id: 'inv1', expiresAt: new Date('2026-07-15T00:00:00Z') }),
    emailExistsAsUser: vi.fn().mockResolvedValue(false),
    hasActivePendingInvite: vi.fn().mockResolvedValue(false),
    teamExists: vi.fn().mockResolvedValue(true),
    acceptInTransaction: vi.fn(),
    ...repo,
  } as unknown as InvitesRepository;
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as QueueService;
  return { svc: new InvitesService(fullRepo, queue), repo: fullRepo, queue };
}

beforeEach(() => vi.clearAllMocks());

describe('InvitesService.create', () => {
  it('rejects a non-admin actor', async () => {
    const { svc } = makeService();
    await expect(svc.create(dto, { ...admin, role: 'MANAGER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an admin to invite into a team that is not their own', async () => {
    // Teams are the unit of management, so hiring into a manager's team is the normal case;
    // requiring the admin's own team would mean every hire lands wrong and needs a move.
    const { svc, repo } = makeService();
    await expect(svc.create(dto, { ...admin, teamId: 'other' })).resolves.toBeDefined();
    expect(vi.mocked(repo.createInvite).mock.calls[0]![0]).toMatchObject({ teamId: 'team1' });
  });

  it('rejects an unknown destination team with a 422, not an FK error', async () => {
    const { svc } = makeService({ teamExists: vi.fn().mockResolvedValue(false) });
    await expect(svc.create(dto, admin)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an email that already belongs to a user', async () => {
    const { svc } = makeService({ emailExistsAsUser: vi.fn().mockResolvedValue(true) });
    await expect(svc.create(dto, admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a duplicate pending invite for the same email', async () => {
    const { svc } = makeService({ hasActivePendingInvite: vi.fn().mockResolvedValue(true) });
    await expect(svc.create(dto, admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('mints a token, persists the invite, and enqueues an invite email', async () => {
    const { svc, repo, queue } = makeService();
    const result = await svc.create(dto, admin);
    expect(result.token).toBeTruthy();
    expect(repo.createInvite).toHaveBeenCalledOnce();
    expect(queue.enqueue).toHaveBeenCalledWith(
      'email',
      'invite',
      expect.objectContaining({ email: dto.email, inviteToken: result.token }),
    );
  });

  it('expires the invite INVITE_TTL_DAYS after creation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
    try {
      const { svc, repo } = makeService();
      await svc.create(dto, admin);
      expect(repo.createInvite).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: new Date('2026-08-17T00:00:00Z') }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('InvitesService.accept', () => {
  it('returns the created identity on a valid token', async () => {
    const identity = { userId: 'u1', role: 'EMPLOYEE' as const, teamId: 'team1' };
    const { svc } = makeService({ acceptInTransaction: vi.fn().mockResolvedValue(identity) });
    await expect(svc.accept('tok', 'password123')).resolves.toEqual(identity);
  });

  it('throws 401 when the invite is invalid/expired/used (repo returns null)', async () => {
    const { svc } = makeService({ acceptInTransaction: vi.fn().mockResolvedValue(null) });
    await expect(svc.accept('tok', 'password123')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
