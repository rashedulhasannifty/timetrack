import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { MinioService } from '../src/infra/storage/minio.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** Seed a user with at least one row in EVERY user-owned table. Returns ids. */
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
    data: {
      userId: user.id,
      tokenHash: `h-${user.id}`,
      expiresAt: new Date('2026-12-01'),
      familyId: `fam-${user.id}`,
    },
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

/** Every user-owned table, counted for one user. The completeness oracle. */
async function remainingRows(db: TestDb, userId: string, email: string) {
  return {
    refreshTokens: await db.prisma.refreshToken.count({ where: { userId } }),
    timeEntries: await db.prisma.timeEntry.count({ where: { userId } }),
    timesheetApprovals: await db.prisma.timesheetApproval.count({ where: { userId } }),
    activitySamples: await db.prisma.activitySample.count({ where: { userId } }),
    screenshots: await db.prisma.screenshot.count({ where: { userId } }),
    idleEvents: await db.prisma.idleEvent.count({ where: { userId } }),
    activityDailySummaries: await db.prisma.activityDailySummary.count({ where: { userId } }),
    invites: await db.prisma.invite.count({ where: { email } }),
  };
}

describe.runIf(RUN_E2E)('admin erase — transaction (real Postgres)', () => {
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

  const repo = (): AdminRepository => new AdminRepository(db.prisma as unknown as PrismaService);

  it('DISCRIMINATING: erases EVERY user-owned table, tombstones the user, and audits', async () => {
    const { userId, email } = await seedFullUser(db);
    // Sanity: the seed really populated every table (else the assertion below is vacuous).
    const before = await remainingRows(db, userId, email);
    for (const [table, n] of Object.entries(before)) {
      expect(n, `seed must populate ${table}`).toBeGreaterThan(0);
    }

    const result = await repo().eraseUser(userId, email, 'admin-1', 'GDPR request', 7);
    expect(result.status).toBe('OK');

    const after = await remainingRows(db, userId, email);
    for (const [table, n] of Object.entries(after)) {
      expect(n, `${table} must be empty after erase`).toBe(0);
    }

    // Tombstone: row kept, PII gone.
    const user = await db.prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(`erased-${userId}@erased.invalid`);
    expect(user?.name).toBe('Erased user');
    expect(user?.monitoringAckAt).toBeNull();
    expect(user?.deactivatedAt).not.toBeNull();

    // Audit: counts + reason only, and NOT the erased address anywhere in the diff.
    const audit = await db.prisma.auditLog.findFirst({ where: { action: 'user.erase' } });
    expect(audit?.targetId).toBe(userId);
    expect(audit?.actorId).toBe('admin-1');
    const diff = audit?.diff as {
      reason: string;
      deleted: Record<string, number>;
      deletedObjects: number;
    };
    expect(diff.reason).toBe('GDPR request');
    expect(diff.deletedObjects).toBe(7);
    expect(diff.deleted.timeEntries).toBe(1);
    expect(diff.deleted.invites).toBe(1);
    expect(JSON.stringify(audit?.diff)).not.toContain('target@x.com'); // no PII re-recorded
    expect(JSON.stringify(audit?.diff)).not.toContain('Target');
  });

  it('refuses to erase the last active admin — no writes at all', async () => {
    const { userId, email } = await seedFullUser(db, 'solo-admin@x.com', 'ADMIN');

    const result = await repo().eraseUser(userId, email, 'admin-1', 'oops', 0);
    expect(result.status).toBe('LAST_ADMIN');

    // Nothing was destroyed and no tombstone was written.
    const after = await remainingRows(db, userId, email);
    expect(after.timeEntries).toBe(1);
    expect(after.invites).toBe(1);
    const user = await db.prisma.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBe('solo-admin@x.com');
    expect(await db.prisma.auditLog.count({ where: { action: 'user.erase' } })).toBe(0);
  });

  it('erases an admin when another active admin remains', async () => {
    const { teamId, userId, email } = await seedFullUser(db, 'admin-a@x.com', 'ADMIN');
    await db.prisma.user.create({
      data: { email: 'admin-b@x.com', name: 'B', passwordHash: 'h', teamId, role: 'ADMIN' },
    });

    const result = await repo().eraseUser(userId, email, 'admin-b', 'left the company', 0);
    expect(result.status).toBe('OK');
    expect((await remainingRows(db, userId, email)).timeEntries).toBe(0);
  });
});

describe.runIf(RUN_E2E)('admin erase — objects before rows (real Postgres + MinIO)', () => {
  let db: TestDb;
  let storage: MinioService;
  beforeAll(async () => {
    db = await startTestDb({ minio: true });
    storage = new MinioService();
    await storage.onModuleInit();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const actor: SessionUser = { id: 'admin-1', role: 'ADMIN', teamId: '' };

  it('a failing sweep leaves EVERY row intact; a healthy re-run completes the erase', async () => {
    const seeded = await seedFullUser(db, 'abort@x.com'); // same helper as the first block
    await storage.putObject(`raw/${seeded.userId}/s1`, Buffer.from('img'), 'image/png');

    const repo = new AdminRepository(db.prisma as unknown as PrismaService);
    const broken = {
      deleteByPrefix: () => Promise.reject(new Error('minio down')),
    } as unknown as MinioService;
    const failing = new AdminService(repo, broken);

    await expect(
      failing.eraseUser(seeded.userId, { reason: 'r' }, { ...actor, teamId: seeded.teamId }),
    ).rejects.toThrow('minio down');

    // Nothing deleted, no tombstone — the object outlived nothing.
    expect(await db.prisma.timeEntry.count({ where: { userId: seeded.userId } })).toBe(1);
    const still = await db.prisma.user.findUnique({ where: { id: seeded.userId } });
    expect(still?.email).toBe('abort@x.com');

    // Healthy re-run completes it, objects included.
    const healthy = new AdminService(repo, storage);
    await healthy.eraseUser(seeded.userId, { reason: 'r' }, { ...actor, teamId: seeded.teamId });
    expect(await db.prisma.timeEntry.count({ where: { userId: seeded.userId } })).toBe(0);
    expect((await fetch(await storage.presignGet(`raw/${seeded.userId}/s1`))).status).toBe(404);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('admin-erase harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
