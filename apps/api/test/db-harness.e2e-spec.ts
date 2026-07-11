import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import { seedAdmin } from '@timetrack/db';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('db harness (e2e)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.close();
  });

  it('boots Postgres, applies migrations, and yields an empty schema', async () => {
    expect(await db.prisma.team.count()).toBe(0);
  });

  it('truncateAll clears application tables', async () => {
    await db.prisma.team.create({ data: { name: 'Engineering', settings: {} } });
    expect(await db.prisma.team.count()).toBe(1);
    await truncateAll(db.prisma);
    expect(await db.prisma.team.count()).toBe(0);
  });

  it('seedAdmin creates an ADMIN whose password verifies', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Ops', settings: {} } });
    const password = 'correct-horse-battery-staple';
    await seedAdmin(db.prisma, { email: 'admin@example.test', password, teamId: team.id });

    const user = await db.prisma.user.findUnique({ where: { email: 'admin@example.test' } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('ADMIN');
    expect(await argon2.verify(user!.passwordHash, password)).toBe(true);
  });
});

// Keeps the file a valid, non-empty suite when e2e is gated off (no Docker needed).
describe('db harness (gated)', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
