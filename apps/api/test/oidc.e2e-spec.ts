import './test-env.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { OidcService } from '../src/modules/auth/oidc.service.js';
import type { InvitesService } from '../src/modules/invites/invites.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import { startFakeIdp, type FakeIdp } from './fake-oidc-idp.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * PRD §6.8 (slice 4.4) — OIDC against a stubbed IdP and a REAL Postgres. The stub serves
 * real discovery + JWKS + RS256-signed ID tokens, so `openid-client` performs genuine
 * signature/issuer/audience/nonce verification here — a mock could not reject a bad nonce.
 */
describe.runIf(RUN_E2E)('auth OIDC (real Postgres + stub IdP)', () => {
  let db: TestDb;
  let idp: FakeIdp;

  beforeAll(async () => {
    db = await startTestDb();
    idp = await startFakeIdp();
    process.env.OIDC_ISSUER = idp.issuer;
    process.env.OIDC_CLIENT_ID = idp.clientId;
    process.env.OIDC_CLIENT_SECRET = idp.clientSecret;
    process.env.OIDC_REDIRECT_URI = 'http://localhost:3000/api/auth/sso/callback';
  });
  afterAll(async () => {
    await idp.close();
    await db.close();
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    delete process.env.OIDC_DEFAULT_TEAM_ID;
  });

  let defaultTeamId: string;
  beforeEach(async () => {
    const team = await db.prisma.team.create({
      data: { name: 'SSO Team', settings: {} },
      select: { id: true },
    });
    defaultTeamId = team.id;
    process.env.OIDC_DEFAULT_TEAM_ID = defaultTeamId;
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  function service(): AuthService {
    const jwt = new JwtService({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    });
    const repo = new AuthRepository(db.prisma as unknown as PrismaService);
    // A fresh OidcService per service() so it reads the current OIDC_* env (new team id).
    return new AuthService(jwt, repo, {} as InvitesService, new OidcService());
  }

  /** Run the full authorize → (stub IdP) → callback handshake with the given claims. */
  async function signIn(
    svc: AuthService,
    claims: { sub: string; email: string; email_verified: boolean; name?: string },
  ) {
    const authorize = await svc.oidcAuthorize();
    const code = idp.makeCode({ ...claims, nonce: authorize.nonce });
    return svc.oidcCallback({
      code,
      state: authorize.state,
      nonce: authorize.nonce,
      codeVerifier: authorize.codeVerifier,
    });
  }

  function decodeSub(accessToken: string): { sub: string; role: string; teamId: string } {
    const segment = accessToken.split('.')[1] ?? '';
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  }

  it('auto-provisions a new user into the default team and issues a token pair', async () => {
    const svc = service();
    const pair = await signIn(svc, {
      sub: 'idp-1',
      email: 'new@company.com',
      email_verified: true,
      name: 'New Person',
    });
    expect(pair.accessToken).toBeTruthy();
    const user = await db.prisma.user.findUnique({ where: { email: 'new@company.com' } });
    expect(user).toMatchObject({
      teamId: defaultTeamId,
      role: 'EMPLOYEE',
      ssoProvider: 'oidc',
      ssoSubject: 'idp-1',
      passwordHash: null,
    });
    expect(decodeSub(pair.accessToken).sub).toBe(user!.id);
  });

  it('links a verified email to an existing password user and preserves role/team', async () => {
    const svc = service();
    const otherTeam = await db.prisma.team.create({
      data: { name: 'Managers', settings: {} },
      select: { id: true },
    });
    const passwordHash = await argon2.hash('password12', { type: argon2.argon2id });
    const existing = await db.prisma.user.create({
      data: {
        email: 'boss@company.com',
        name: 'Boss',
        passwordHash,
        role: 'MANAGER',
        teamId: otherTeam.id,
      },
      select: { id: true },
    });

    const pair = await signIn(svc, {
      sub: 'idp-boss',
      email: 'boss@company.com',
      email_verified: true,
    });

    const claims = decodeSub(pair.accessToken);
    expect(claims.sub).toBe(existing.id);
    expect(claims.role).toBe('MANAGER');
    expect(claims.teamId).toBe(otherTeam.id); // linked, NOT moved into the default team
    const linked = await db.prisma.user.findUnique({ where: { id: existing.id } });
    expect(linked).toMatchObject({ ssoProvider: 'oidc', ssoSubject: 'idp-boss' });
  });

  it('reuses the same user on a second sign-in matched by subject (no duplicate)', async () => {
    const svc = service();
    const first = await signIn(svc, { sub: 'idp-2', email: 'repeat@company.com', email_verified: true });
    const second = await signIn(svc, {
      sub: 'idp-2',
      email: 'repeat@company.com',
      email_verified: true,
    });
    expect(decodeSub(first.accessToken).sub).toBe(decodeSub(second.accessToken).sub);
    const count = await db.prisma.user.count({ where: { email: 'repeat@company.com' } });
    expect(count).toBe(1);
  });

  it('rejects a mismatched nonce (real openid-client ID-token verification) with 401', async () => {
    const svc = service();
    const authorize = await svc.oidcAuthorize();
    // The stub signs an ID token carrying a DIFFERENT nonce than the flow expects.
    const code = idp.makeCode({
      sub: 'idp-3',
      email: 'evil@company.com',
      email_verified: true,
      nonce: 'a-different-nonce',
    });
    await expect(
      svc.oidcCallback({
        code,
        state: authorize.state,
        nonce: authorize.nonce,
        codeVerifier: authorize.codeVerifier,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await db.prisma.user.count()).toBe(0);
  });

  it('rejects an unverified email (no provision) with 403', async () => {
    const svc = service();
    await expect(
      signIn(svc, { sub: 'idp-4', email: 'unverified@company.com', email_verified: false }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.prisma.user.count({ where: { email: 'unverified@company.com' } })).toBe(0);
  });

  it('rejects a deactivated user matched by subject with 403', async () => {
    const svc = service();
    await db.prisma.user.create({
      data: {
        email: 'gone@company.com',
        name: 'Gone',
        teamId: defaultTeamId,
        ssoProvider: 'oidc',
        ssoSubject: 'idp-5',
        deactivatedAt: new Date(),
      },
    });
    await expect(
      signIn(svc, { sub: 'idp-5', email: 'gone@company.com', email_verified: true }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
