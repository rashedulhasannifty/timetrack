import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('time-entries repository — real Postgres', () => {
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

  // time_entries.userId is an FK to users.id, so every entry needs a real user.
  async function seedUser(email = 'e1@example.com') {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const user = await db.prisma.user.create({
      data: { email, name: 'E One', passwordHash: 'x', teamId: team.id },
      select: { id: true, teamId: true },
    });
    return user;
  }

  function running(id: string, userId: string) {
    return {
      id,
      userId,
      projectId: null,
      taskId: null,
      source: 'AUTO' as const,
      note: null,
      startTime: new Date('2026-07-11T09:00:00Z'),
      endTime: null,
    };
  }

  it('the partial unique index rejects a second running entry for the same user', async () => {
    const user = await seedUser();
    await db.prisma.timeEntry.create({
      data: running('019797a0-0000-7000-8000-000000000001', user.id),
    });

    // A different id, same user, also open (endTime null) -> partial unique index violation.
    // Prisma raises a known-request error with code P2002 on a unique-constraint breach.
    await expect(
      db.prisma.timeEntry.create({
        data: running('019797a0-0000-7000-8000-000000000002', user.id),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows two CLOSED entries for the same user (index only constrains open ones)', async () => {
    const user = await seedUser();
    const closed = (id: string) => ({
      ...running(id, user.id),
      endTime: new Date('2026-07-11T10:00:00Z'),
    });
    await db.prisma.timeEntry.create({ data: closed('019797a0-0000-7000-8000-000000000003') });
    await db.prisma.timeEntry.create({ data: closed('019797a0-0000-7000-8000-000000000004') });
    const count = await db.prisma.timeEntry.count({ where: { userId: user.id } });
    expect(count).toBe(2);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('time-entries e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
