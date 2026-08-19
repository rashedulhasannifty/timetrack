import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

// Decouple the unit test from real env and native argon2 (slow) — both are mocked.
// oidcConfig is the real helper (it just reads the env object) so provisioning can find
// OIDC_DEFAULT_TEAM_ID; the SSO tests set OIDC_* so oidcConfig returns a live config.
vi.mock('@timetrack/config', async () => {
  const actual = await vi.importActual<typeof import('@timetrack/config')>('@timetrack/config');
  return {
    oidcConfig: actual.oidcConfig,
    loadEnv: () => ({
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
      REFRESH_GRACE_SECONDS: 10,
      JWT_REFRESH_SECRET: 'test-refresh-secret-000000000000000000',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_REDIRECT_URI: 'https://app.example.com/api/auth/sso/callback',
      OIDC_DEFAULT_TEAM_ID: 'team-default',
    }),
  };
});

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
  familyId: 'fam1',
  expiresAt: new Date(Date.now() + 1_000_000),
  revokedAt: null,
};

function makeService(
  repo: Partial<AuthRepository> = {},
  invites: Partial<{ accept: unknown }> = {},
  oidc: Partial<import('./oidc.service.js').OidcService> = {},
) {
  const jwt = { signAsync: vi.fn().mockResolvedValue('access.jwt.token') } as unknown as JwtService;
  const fullRepo = {
    findByEmail: vi.fn(),
    findIdentityById: vi.fn(),
    findBySsoIdentity: vi.fn(),
    findIdentityByEmail: vi.fn(),
    linkSso: vi.fn().mockResolvedValue(undefined),
    createSsoUser: vi.fn(),
    createRefreshToken: vi.fn().mockResolvedValue('rt2'),
    findRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    rotateRefreshToken: vi.fn().mockResolvedValue('rt2'),
    revokeFamily: vi.fn().mockResolvedValue(0),
    ...repo,
  } as unknown as AuthRepository;
  const invitesSvc = {
    accept: vi.fn(),
    ...invites,
  } as unknown as import('../invites/invites.service.js').InvitesService;
  const oidcSvc = {
    isEnabled: vi.fn().mockReturnValue(true),
    authorize: vi.fn(),
    verifyCallback: vi.fn(),
    ...oidc,
  } as unknown as import('./oidc.service.js').OidcService;
  return {
    svc: new AuthService(jwt, fullRepo, invitesSvc, oidcSvc),
    repo: fullRepo,
    invites: invitesSvc,
    oidc: oidcSvc,
  };
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

  it('rejects an SSO-only user (null passwordHash) without calling argon2.verify', async () => {
    const { svc } = makeService({
      findByEmail: vi.fn().mockResolvedValue({ ...USER, passwordHash: null }),
    });
    await expect(svc.login({ email: 'a@b.co', password: 'anything' })).rejects.toThrow(
      UnauthorizedException,
    );
    // verify must never run on a null hash (it would throw → 500); time is still burned.
    expect(argon2.verify).not.toHaveBeenCalled();
    expect(argon2.hash).toHaveBeenCalled();
  });
});

describe('AuthService.oidcCallback', () => {
  const identity = {
    sub: 'idp-sub-1',
    email: 'sso@company.com',
    emailVerified: true,
    name: 'SSO User',
  };

  it('reuses an existing user matched by (provider, subject) — bypassing the email gate', async () => {
    const { svc, repo } = makeService(
      {
        findBySsoIdentity: vi.fn().mockResolvedValue(IDENTITY),
        findIdentityByEmail: vi.fn(),
      },
      {},
      { verifyCallback: vi.fn().mockResolvedValue({ ...identity, emailVerified: false }) },
    );
    const pair = await svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' });
    expect(pair.accessToken).toBe('access.jwt.token');
    // Subject match short-circuits: no email lookup, no link, no create.
    expect(repo.findIdentityByEmail).not.toHaveBeenCalled();
    expect(repo.linkSso).not.toHaveBeenCalled();
    expect(repo.createSsoUser).not.toHaveBeenCalled();
  });

  it('links a verified email to an existing user and backfills the sso identity', async () => {
    const { svc, repo } = makeService(
      {
        findBySsoIdentity: vi.fn().mockResolvedValue(null),
        findIdentityByEmail: vi.fn().mockResolvedValue(IDENTITY),
      },
      {},
      { verifyCallback: vi.fn().mockResolvedValue(identity) },
    );
    const pair = await svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' });
    expect(pair.accessToken).toBe('access.jwt.token');
    expect(repo.linkSso).toHaveBeenCalledWith('u1', 'oidc', 'idp-sub-1');
    expect(repo.createSsoUser).not.toHaveBeenCalled();
  });

  it('auto-provisions a new user into the default team when no match exists', async () => {
    const { svc, repo } = makeService(
      {
        findBySsoIdentity: vi.fn().mockResolvedValue(null),
        findIdentityByEmail: vi.fn().mockResolvedValue(null),
        createSsoUser: vi.fn().mockResolvedValue({ ...IDENTITY, id: 'new' }),
      },
      {},
      { verifyCallback: vi.fn().mockResolvedValue(identity) },
    );
    await svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' });
    expect(repo.createSsoUser).toHaveBeenCalledWith({
      email: 'sso@company.com',
      name: 'SSO User',
      teamId: 'team-default',
      ssoProvider: 'oidc',
      ssoSubject: 'idp-sub-1',
    });
  });

  it('REJECTS an unverified email on the LINK path (no link, no provision) — anti-takeover', async () => {
    const findIdentityByEmail = vi.fn().mockResolvedValue(IDENTITY);
    const { svc, repo } = makeService(
      { findBySsoIdentity: vi.fn().mockResolvedValue(null), findIdentityByEmail },
      {},
      { verifyCallback: vi.fn().mockResolvedValue({ ...identity, emailVerified: false }) },
    );
    await expect(
      svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).rejects.toThrow(ForbiddenException);
    // The gate sits ABOVE the email branch: no lookup, no link.
    expect(findIdentityByEmail).not.toHaveBeenCalled();
    expect(repo.linkSso).not.toHaveBeenCalled();
    expect(repo.createSsoUser).not.toHaveBeenCalled();
  });

  it('REJECTS an unverified email on the PROVISION path', async () => {
    const { svc, repo } = makeService(
      { findBySsoIdentity: vi.fn().mockResolvedValue(null), findIdentityByEmail: vi.fn() },
      {},
      { verifyCallback: vi.fn().mockResolvedValue({ ...identity, emailVerified: false }) },
    );
    await expect(
      svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.createSsoUser).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent-create race (P2002) by resolving to the winner row', async () => {
    const { SsoConcurrentCreateError } = await import('./auth.repository.js');
    const findBySsoIdentity = vi
      .fn()
      .mockResolvedValueOnce(null) // initial lookup: no user yet
      .mockResolvedValueOnce({ ...IDENTITY, id: 'winner' }); // after the race: the winner's row
    const { svc, repo } = makeService(
      {
        findBySsoIdentity,
        findIdentityByEmail: vi.fn().mockResolvedValue(null),
        createSsoUser: vi.fn().mockRejectedValue(new SsoConcurrentCreateError()),
      },
      {},
      { verifyCallback: vi.fn().mockResolvedValue(identity) },
    );
    const pair = await svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' });
    expect(pair.accessToken).toBe('access.jwt.token');
    expect(repo.findBySsoIdentity).toHaveBeenCalledTimes(2);
  });

  it('rejects a deactivated user matched by subject', async () => {
    const { svc } = makeService(
      { findBySsoIdentity: vi.fn().mockResolvedValue({ ...IDENTITY, deactivatedAt: new Date() }) },
      {},
      { verifyCallback: vi.fn().mockResolvedValue(identity) },
    );
    await expect(
      svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s when SSO is disabled, without calling the IdP', async () => {
    const verifyCallback = vi.fn();
    const { svc } = makeService(
      {},
      {},
      { isEnabled: vi.fn().mockReturnValue(false), verifyCallback },
    );
    await expect(
      svc.oidcCallback({ code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).rejects.toThrow(NotFoundException);
    expect(verifyCallback).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rotates: claims the presented token and mints its successor in one transaction', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue(liveToken),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
    });
    const pair = await svc.refresh({ refreshToken: 'opaque' });
    expect(repo.rotateRefreshToken).toHaveBeenCalledWith(
      'rt1',
      'u1',
      expect.any(String),
      expect.any(Date),
      expect.any(Date),
      'fam1', // the successor stays in the presented token's family
    );
    // The successor is created INSIDE the rotation, never as a second unlinked write.
    expect(repo.createRefreshToken).not.toHaveBeenCalled();
    expect(pair.accessToken).toBe('access.jwt.token');
  });

  it('serves the loser of a concurrent ROTATION — the multi-tab case', async () => {
    // null = the conditional UPDATE matched 0 rows. Re-reading shows a sibling refresh
    // rotated microseconds earlier, so the caller presented a token that was live when
    // they read it: serve them an unlinked pair.
    const rotatedByPeer = { ...liveToken, revokedAt: new Date(), replacedById: 'rt9' };
    const { svc, repo } = makeService({
      findRefreshToken: vi
        .fn()
        .mockResolvedValueOnce(liveToken)
        .mockResolvedValueOnce(rotatedByPeer),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
      rotateRefreshToken: vi.fn().mockResolvedValue(null),
    });
    const pair = await svc.refresh({ refreshToken: 'opaque' });
    expect(repo.rotateRefreshToken).toHaveBeenCalledOnce();
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
    expect(pair.accessToken).toBe('access.jwt.token');
  });

  it('lets a concurrent LOGOUT win the race instead of resurrecting the token', async () => {
    // Same lost claim, different cause: revokedAt set with NO successor is a logout. The
    // old unconditional write overwrote it and handed back a live successor anyway.
    const loggedOut = { ...liveToken, revokedAt: new Date(), replacedById: null };
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValueOnce(liveToken).mockResolvedValueOnce(loggedOut),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
      rotateRefreshToken: vi.fn().mockResolvedValue(null),
    });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    expect(repo.createRefreshToken).not.toHaveBeenCalled();
  });

  it('does not re-claim on the grace path — the window must not slide on replay', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi
        .fn()
        .mockResolvedValue({ ...liveToken, revokedAt: new Date(), replacedById: 'rt2' }),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
    });
    await svc.refresh({ refreshToken: 'opaque' });
    expect(repo.rotateRefreshToken).not.toHaveBeenCalled();
    expect(repo.createRefreshToken).toHaveBeenCalledOnce();
  });

  it('rejects a revoked token (replay) and does not re-revoke', async () => {
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue({ ...liveToken, revokedAt: new Date() }),
    });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    expect(repo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes the whole family when a long-rotated token is replayed', async () => {
    // Outside the grace window with a successor present = reuse. The chain is compromised.
    const replayed = {
      ...liveToken,
      revokedAt: new Date(Date.now() - 60_000),
      replacedById: 'rt2',
    };
    const { svc, repo } = makeService({ findRefreshToken: vi.fn().mockResolvedValue(replayed) });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    expect(repo.revokeFamily).toHaveBeenCalledWith('fam1', expect.any(Date));
  });

  it('does NOT revoke the family for a replayed logout — that is not reuse', async () => {
    // revokedAt with no successor is a logout. Replaying it is a client retrying, not
    // evidence of theft; nuking the chain would punish a normal sign-out.
    const loggedOut = {
      ...liveToken,
      revokedAt: new Date(Date.now() - 60_000),
      replacedById: null,
    };
    const { svc, repo } = makeService({ findRefreshToken: vi.fn().mockResolvedValue(loggedOut) });
    await expect(svc.refresh({ refreshToken: 'opaque' })).rejects.toThrow(UnauthorizedException);
    expect(repo.revokeFamily).not.toHaveBeenCalled();
  });

  it('does NOT revoke the family inside the grace window — that is the multi-tab case', async () => {
    const justRotated = { ...liveToken, revokedAt: new Date(), replacedById: 'rt2' };
    const { svc, repo } = makeService({
      findRefreshToken: vi.fn().mockResolvedValue(justRotated),
      findIdentityById: vi.fn().mockResolvedValue(IDENTITY),
    });
    await svc.refresh({ refreshToken: 'opaque' });
    expect(repo.revokeFamily).not.toHaveBeenCalled();
    // and the graced token stays in its original family rather than forking a new chain
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      expect.any(Date),
      'fam1',
    );
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
    expect(repo.rotateRefreshToken).not.toHaveBeenCalled();
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
