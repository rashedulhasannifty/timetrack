import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Decouple the unit test from real env and native argon2 (slow) — both are mocked.
vi.mock('@timetrack/config', () => ({
  loadEnv: () => ({
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '30d',
    REFRESH_GRACE_SECONDS: 10,
    JWT_REFRESH_SECRET: 'test-refresh-secret-000000000000000000',
  }),
}));

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('hashed'),
  verify: vi.fn(),
  argon2id: 2,
}));

import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { JwtService } from '@nestjs/jwt';

const USER = {
  id: 'u1',
  email: 'a@b.co',
  passwordHash: 'stored-hash',
  role: 'EMPLOYEE' as const,
  teamId: 't1',
  deactivatedAt: null,
};
const IDENTITY = { id: 'u1', role: 'EMPLOYEE' as const, teamId: 't1', deactivatedAt: null };
const liveToken = {
  id: 'rt1',
  userId: 'u1',
  expiresAt: new Date(Date.now() + 1_000_000),
  revokedAt: null,
};

function makeService(
  repo: Partial<AuthRepository> = {},
  invites: Partial<{ accept: unknown }> = {},
) {
  const jwt = { signAsync: vi.fn().mockResolvedValue('access.jwt.token') } as unknown as JwtService;
  const fullRepo = {
    findByEmail: vi.fn(),
    findIdentityById: vi.fn(),
    createRefreshToken: vi.fn().mockResolvedValue('rt2'),
    findRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    markRotated: vi.fn().mockResolvedValue(undefined),
    ...repo,
  } as unknown as AuthRepository;
  const invitesSvc = {
    accept: vi.fn(),
    ...invites,
  } as unknown as import('../invites/invites.service.js').InvitesService;
  return { svc: new AuthService(jwt, fullRepo, invitesSvc), repo: fullRepo, invites: invitesSvc };
}

beforeEach(() => vi.clearAllMocks());

describe('AuthService.login', () => {
  it('issues a token pair and stores a refresh token on valid credentials', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(true);
    const { svc, repo } = makeService({ findByEmail: vi.fn().mockResolvedValue(USER) });
    const pair = await svc.login({ email: 'a@b.co', password: 'correct-horse' });
    expect(pair.accessToken).toBe('access.jwt.token');
    expect(pair.refreshToken).toEqual(expect.any(String));
    expect(pair.expiresIn).toBe(900);
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
  });

  it('rejects a wrong password with 401', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(false);
    const { svc } = makeService({ findByEmail: vi.fn().mockResolvedValue(USER) });
    await expect(svc.login({ email: 'a@b.co', password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown email and still burns time (no enumeration)', async () => {
    const { svc } = makeService({ findByEmail: vi.fn().mockResolvedValue(null) });
    await expect(svc.login({ email: 'nope@b.co', password: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(argon2.hash).toHaveBeenCalled();
  });

  it('rejects a deactivated user', async () => {
    const { svc } = makeService({
      findByEmail: vi.fn().mockResolvedValue({ ...USER, deactivatedAt: new Date() }),
    });
    await expect(svc.login({ email: 'a@b.co', password: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthService.refresh', () => {
  it('rotates: marks the presented token rotated (linked to its successor) and issues a fresh pair', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue(liveToken),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
    });
    const pair = await svc.refresh({ refreshToken: 'opaque' });
    expect(repo.markRotated).toHaveBeenCalledWith('rt1', expect.any(Date), expect.any(String));
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
    expect(pair.accessToken).toBe('access.jwt.token');
  });

  it('rejects a revoked token (replay) and does not re-revoke', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue({ ...liveToken, revokedAt: new Date() }),
    });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { svc } = makeService({
      findRefreshToken: vi
        .fn()
        .mockResolvedValue({ ...liveToken, expiresAt: new Date(Date.now() - 1000) }),
    });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown token', async () => {
    const { svc } = makeService({ findRefreshToken: vi.fn().mockResolvedValue(null) });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects if the user was deactivated since issuance, without rotating the token', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue(liveToken),
      findIdentityById: vi.fn().mockResolvedValue({ ...IDENTITY, deactivatedAt: new Date() }),
    });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    // Identity is checked before rotation, so a deactivated user's token is left untouched.
    expect(repo.markRotated).not.toHaveBeenCalled();
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthService.acceptInvite', () => {
  it('accepts the invite and issues a token pair for the new user', async () => {
    const { svc, repo, invites } = makeService(
      {},
      { accept: vi.fn().mockResolvedValue({ userId: 'u9', role: 'EMPLOYEE', teamId: 't1' }) },
    );
    const pair = await svc.acceptInvite({ token: 'tok', password: 'password123' });
    expect(invites.accept).toHaveBeenCalledWith('tok', 'password123');
    expect(pair.accessToken).toBe('access.jwt.token');
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
  });
});

describe('AuthService.logout', () => {
  it('revokes a live token', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue(liveToken),
    });
    await svc.logout({ refreshToken: 'opaque' });
    expect(repo.revokeRefreshToken).toHaveBeenCalledWith('rt1', expect.any(Date));
  });

  it('is a no-op for an unknown token', async () => {
    const { svc, repo } = makeService({ findRefreshToken: vi.fn().mockResolvedValue(null) });
    await expect(svc.logout({ refreshToken: 'opaque' })).resolves.toBeUndefined();
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });
});
