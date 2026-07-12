import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('users management — real Postgres', () => {
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

  function repo(): UsersRepository {
    return new UsersRepository(db.prisma as unknown as PrismaService);
  }

  async function seedUser(teamId: string, email = 'e@ex.co') {
    return db.prisma.user.create({
      data: { email, name: 'E', role: 'EMPLOYEE', teamId, passwordHash: 'x' },
      select: { id: true },
    });
  }

  it('deactivate sets deactivatedAt, revokes refresh tokens, and audits', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const user = await seedUser(team.id);
    await db.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: 'h1', expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const result = await repo().setActive(user.id, true, 'admin1');
    expect(result.deactivatedAt).not.toBeNull();

    const tokens = await db.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);

    const audit = await db.prisma.auditLog.findMany({ where: { targetId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('user.deactivate');
  });

  it('reactivate clears deactivatedAt, mints no tokens, and audits', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const user = await seedUser(team.id);
    await repo().setActive(user.id, true, 'admin1');

    const result = await repo().setActive(user.id, false, 'admin1');
    expect(result.deactivatedAt).toBeNull();

    const tokens = await db.prisma.refreshToken.count({ where: { userId: user.id } });
    expect(tokens).toBe(0);

    const audit = await db.prisma.auditLog.findMany({
      where: { targetId: user.id },
      orderBy: { timestamp: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['user.deactivate', 'user.reactivate']);
  });
});
