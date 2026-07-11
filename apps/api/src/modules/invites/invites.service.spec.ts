import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

vi.mock('argon2', () => ({ hash: vi.fn().mockResolvedValue('hashed'), argon2id: 2 }));

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

  it('rejects inviting into another team', async () => {
    const { svc } = makeService();
    await expect(svc.create(dto, { ...admin, teamId: 'other' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an email that already belongs to a user', async () => {
    const { svc } = makeService({ emailExistsAsUser: vi.fn().mockResolvedValue(true) });
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
