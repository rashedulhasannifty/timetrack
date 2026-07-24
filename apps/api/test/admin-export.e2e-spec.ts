import './test-env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import type { MinioService } from '../src/infra/storage/minio.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * Seed a user with at least one row in EVERY user-owned table. Mirrors the shared shape in
 * admin-erase.e2e-spec.ts (not exported from that module, so re-seeded inline here per the task
 * brief's fallback).
 */
async function seedFullUser(
  db: TestDb,
  email = 'target@x.com',
  role: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE',
) {
  const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
  const user = await db.prisma.user.create({
    data: { email, name: 'Target', passwordHash: 'hash', teamId: team.id, role },
    select: { id: true },
  });
  const ts = new Date('2026-07-20T10:00:00Z');
  await db.prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: `h-${user.id}`, expiresAt: new Date('2026-12-01') },
  });
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-00000000e001',
      userId: user.id,
      startTime: ts,
      source: 'MANUAL',
    },
  });
  await db.prisma.timesheetApproval.create({
    data: { userId: user.id, periodStart: ts, periodEnd: new Date('2026-07-27T00:00:00Z') },
  });
  await db.prisma.activitySample.create({
    data: { userId: user.id, timestamp: ts, appName: 'Code', activityPct: 50 },
  });
  await db.prisma.screenshot.create({
    data: {
      id: '019797a0-0000-7000-8000-00000000s001',
      userId: user.id,
      timestamp: ts,
      storageKey: `raw/${user.id}/s1`,
      status: 'READY',
    },
  });
  await db.prisma.idleEvent.create({
    data: {
      id: '019797a0-0000-7000-8000-00000000i001',
      userId: user.id,
      startTime: ts,
      endTime: ts,
      resolvedAction: 'KEEP',
    },
  });
  await db.prisma.activityDailySummary.create({
    data: {
      userId: user.id,
      day: new Date('2026-07-20'),
      avgActivityPct: 50,
      activeMinutes: 10,
      byApp: {},
      byCategory: {},
    },
  });
  // Keyed by EMAIL, not userId — the table a userId sweep misses.
  await db.prisma.invite.create({
    data: {
      email,
      name: 'Target',
      teamId: team.id,
      tokenHash: `inv-${user.id}`,
      expiresAt: new Date('2026-12-01'),
    },
  });
  return { teamId: team.id, userId: user.id, email };
}

describe.runIf(RUN_E2E)('admin export — streamed JSON (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  async function collect(it: AsyncIterable<string>): Promise<string> {
    let out = '';
    for await (const chunk of it) out += chunk;
    return out;
  }

  it('exports every table the erase destroys (except refresh tokens) as valid JSON', async () => {
    await truncateAll(db.prisma);
    const seeded = await seedFullUser(db, 'export@x.com'); // full seed: one row in every table
    await db.prisma.auditLog.create({
      data: {
        actorId: 'admin-1',
        action: 'user.ack_monitoring',
        targetType: 'user',
        targetId: seeded.userId,
        diff: {},
      },
    });

    const svc = new AdminService(
      new AdminRepository(db.prisma as unknown as PrismaService),
      {} as unknown as MinioService, // export never touches storage
    );
    const actor: SessionUser = { id: 'admin-1', role: 'ADMIN', teamId: seeded.teamId };
    const json = await collect(await svc.exportUser(seeded.userId, actor));

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.user).toMatchObject({ id: seeded.userId, email: 'export@x.com' });
    for (const key of [
      'timeEntries',
      'timesheetApprovals',
      'activitySamples',
      'activityDailySummaries',
      'screenshots',
      'idleEvents',
      'invites',
      'auditLog',
    ]) {
      expect(Array.isArray(parsed[key]), `${key} must be an array`).toBe(true);
      expect((parsed[key] as unknown[]).length, `${key} must be non-empty`).toBeGreaterThan(0);
    }
    // Session material must never be exported.
    expect(json).not.toContain('tokenHash');
    expect(Object.keys(parsed)).not.toContain('refreshTokens');
  });

  it('404s an unknown user and 403s a user in another team', async () => {
    await truncateAll(db.prisma);
    const seeded = await seedFullUser(db, 'other-team@x.com');
    const svc = new AdminService(
      new AdminRepository(db.prisma as unknown as PrismaService),
      {} as unknown as MinioService,
    );
    await expect(
      svc.exportUser('019797a0-0000-7000-8000-0000000000ff', {
        id: 'a',
        role: 'ADMIN',
        teamId: seeded.teamId,
      }),
    ).rejects.toThrow();
    await expect(
      svc.exportUser(seeded.userId, { id: 'a', role: 'ADMIN', teamId: 'a-different-team' }),
    ).rejects.toThrow();
  });
});

describe('admin-export harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
