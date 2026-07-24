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

  async function seedUser(
    teamId: string,
    email = 'e@ex.co',
    role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN' = 'EMPLOYEE',
  ) {
    return db.prisma.user.create({
      data: { email, name: 'E', role, teamId, passwordHash: 'x' },
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
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') throw new Error('unreachable');
    expect(result.user.deactivatedAt).not.toBeNull();

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
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') throw new Error('unreachable');
    expect(result.user.deactivatedAt).toBeNull();

    const tokens = await db.prisma.refreshToken.count({ where: { userId: user.id } });
    expect(tokens).toBe(0);

    const audit = await db.prisma.auditLog.findMany({
      where: { targetId: user.id },
      orderBy: { timestamp: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['user.deactivate', 'user.reactivate']);
  });

  it('refuses to deactivate the last active admin and writes nothing', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const admin = await seedUser(team.id, 'admin@ex.co', 'ADMIN');

    const result = await repo().setActive(admin.id, true, 'actor1');
    expect(result.status).toBe('LAST_ADMIN');

    const row = await db.prisma.user.findUnique({
      where: { id: admin.id },
      select: { deactivatedAt: true },
    });
    expect(row?.deactivatedAt).toBeNull();
    const audit = await db.prisma.auditLog.count({ where: { targetId: admin.id } });
    expect(audit).toBe(0);
  });

  it('deactivates an admin when another active admin remains', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const a1 = await seedUser(team.id, 'a1@ex.co', 'ADMIN');
    await seedUser(team.id, 'a2@ex.co', 'ADMIN');

    const result = await repo().setActive(a1.id, true, 'actor1');
    expect(result.status).toBe('OK');
    const row = await db.prisma.user.findUnique({
      where: { id: a1.id },
      select: { deactivatedAt: true },
    });
    expect(row?.deactivatedAt).not.toBeNull();
  });

  it('setRole changes the role and writes a role_change audit row', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const user = await seedUser(team.id, 'e@ex.co', 'EMPLOYEE');

    const result = await repo().setRole(user.id, 'MANAGER', 'admin1');
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') throw new Error('unreachable');
    expect(result.user.role).toBe('MANAGER');

    const audit = await db.prisma.auditLog.findMany({ where: { targetId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('user.role_change');
    expect((audit[0]?.diff as { role: string; from: string }).role).toBe('MANAGER');
    expect((audit[0]?.diff as { role: string; from: string }).from).toBe('EMPLOYEE');
  });

  it('refuses to demote the last active admin and writes nothing', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const admin = await seedUser(team.id, 'admin@ex.co', 'ADMIN');

    const result = await repo().setRole(admin.id, 'EMPLOYEE', 'actor1');
    expect(result.status).toBe('LAST_ADMIN');

    const row = await db.prisma.user.findUnique({
      where: { id: admin.id },
      select: { role: true },
    });
    expect(row?.role).toBe('ADMIN');
    const audit = await db.prisma.auditLog.count({ where: { targetId: admin.id } });
    expect(audit).toBe(0);
  });

  it('demotes an admin when another active admin remains', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const a1 = await seedUser(team.id, 'a1@ex.co', 'ADMIN');
    await seedUser(team.id, 'a2@ex.co', 'ADMIN');

    const result = await repo().setRole(a1.id, 'MANAGER', 'actor1');
    expect(result.status).toBe('OK');
    const row = await db.prisma.user.findUnique({ where: { id: a1.id }, select: { role: true } });
    expect(row?.role).toBe('MANAGER');
  });

  it('ackMonitoring sets monitoringAckAt and audits the policy version', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const user = await seedUser(team.id);

    const result = await repo().ackMonitoring(user.id, 'policy-2026-07', user.id);
    expect(result.monitoringAckAt).not.toBeNull();

    const audit = await db.prisma.auditLog.findMany({ where: { targetId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('user.ack_monitoring');
    expect((audit[0]?.diff as { policyVersion: string }).policyVersion).toBe('policy-2026-07');
  });
});
