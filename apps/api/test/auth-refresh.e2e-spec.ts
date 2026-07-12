import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import type { InvitesService } from '../src/modules/invites/invites.service.js';
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
    // refresh() never touches InvitesService; a bare stub is safe here.
    return new AuthService(jwt, repo, {} as InvitesService);
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
