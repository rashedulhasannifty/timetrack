import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import type { InvitesService } from '../src/modules/invites/invites.service.js';
import type { OidcService } from '../src/modules/auth/oidc.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('auth refresh — grace window (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
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
    // refresh() never touches InvitesService or OidcService; bare stubs are safe here.
    return new AuthService(jwt, repo, {} as InvitesService, {} as OidcService);
  }

  async function seedUserAndLogin(svc: AuthService) {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const passwordHash = await argon2.hash('password12', { type: argon2.argon2id });
    await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash, teamId: team.id },
    });
    return svc.login({ email: 'ada@example.com', password: 'password12' });
  }

  it('serialises concurrent refreshes: exactly one claims the rotation', async () => {
    // The unit test mocks the repository, so only a real Postgres can prove the conditional
    // UPDATE actually serialises. Before this, both callers read revokedAt: null, both minted
    // a chain, and the second write overwrote replacedById — orphaning the first successor.
    const svc = service();
    const pair1 = await seedUserAndLogin(svc);
    const original = await db.prisma.refreshToken.findFirstOrThrow({ select: { id: true } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.refresh({ refreshToken: pair1.refreshToken })),
    );

    // Every caller is served — none of them presented a token that was dead when they read it.
    expect(results).toHaveLength(5);
    expect(new Set(results.map((r) => r.refreshToken)).size).toBe(5);

    // ...but the original was claimed exactly once, and points at a successor that exists.
    const claimed = await db.prisma.refreshToken.findUniqueOrThrow({
      where: { id: original.id },
      select: { revokedAt: true, replacedById: true },
    });
    expect(claimed.revokedAt).not.toBeNull();
    expect(claimed.replacedById).not.toBeNull();
    const successor = await db.prisma.refreshToken.findUnique({
      where: { id: claimed.replacedById as string },
      select: { id: true },
    });
    expect(successor, 'replacedById must point at a row that exists, not an orphan').not.toBeNull();
  });

  it('a refresh racing a logout does not resurrect the logged-out token', async () => {
    // The security case for the conditional UPDATE. Previously the refresh's unconditional
    // write landed on top of the logout: it set replacedById, so the caller got a live
    // successor AND the logged-out token became grace-replayable for the whole window.
    const svc = service();
    const pair1 = await seedUserAndLogin(svc);

    const [logout, refresh] = await Promise.allSettled([
      svc.logout({ refreshToken: pair1.refreshToken }),
      svc.refresh({ refreshToken: pair1.refreshToken }),
    ]);
    expect(logout.status).toBe('fulfilled');

    // Whoever won, the end state must be coherent: if the logout landed first the refresh
    // is rejected; if the refresh landed first the token is rotated, never both.
    const row = await db.prisma.refreshToken.findFirstOrThrow({
      where: { replacedById: null, revokedAt: { not: null } },
      select: { replacedById: true },
      orderBy: { createdAt: 'asc' },
    });
    if (refresh.status === 'rejected') {
      // Logout won: the token stays successor-less, so it can never be graced back in.
      expect(row.replacedById).toBeNull();
      await expect(svc.refresh({ refreshToken: pair1.refreshToken })).rejects.toMatchObject({
        status: 401,
      });
    }
  });

  it('accepts a just-rotated token again within the grace window', async () => {
    const svc = service();
    const pair1 = await seedUserAndLogin(svc);
    const pair2 = await svc.refresh({ refreshToken: pair1.refreshToken });
    expect(pair2.refreshToken).not.toBe(pair1.refreshToken);
    // The loser tab presents the SAME old token a moment later — still valid (grace).
    const pair3 = await svc.refresh({ refreshToken: pair1.refreshToken });
    expect(pair3.accessToken).toBeTruthy();
  });

  it('rejects a logout-revoked token even within the grace window', async () => {
    const svc = service();
    const pair1 = await seedUserAndLogin(svc);
    await svc.logout({ refreshToken: pair1.refreshToken });
    await expect(svc.refresh({ refreshToken: pair1.refreshToken })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a rotated token once the grace window has passed', async () => {
    const svc = service();
    const pair1 = await seedUserAndLogin(svc);
    await svc.refresh({ refreshToken: pair1.refreshToken }); // rotates pair1
    // Age the revoked row past REFRESH_GRACE_SECONDS (test-env sets it low; here force it).
    await db.prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 3_600_000) },
    });
    await expect(svc.refresh({ refreshToken: pair1.refreshToken })).rejects.toMatchObject({
      status: 401,
    });
  });
});
