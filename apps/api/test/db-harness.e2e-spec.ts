import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});

// Keeps the file a valid, non-empty suite when e2e is gated off (no Docker needed).
describe('db harness (gated)', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
