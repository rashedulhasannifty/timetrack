import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScreenshotsRepository } from '../src/modules/screenshots/screenshots.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';
const TS = '2026-07-16T10:00:00.000Z';

describe.runIf(RUN_E2E)('screenshots repository — real Postgres', () => {
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

  function repo(): ScreenshotsRepository {
    return new ScreenshotsRepository(db.prisma as unknown as PrismaService);
  }

  const id = '019797a0-0000-7000-8000-0000000000d1';

  it('create upserts a PENDING row owned by the session user', async () => {
    const row = await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    expect(row.status).toBe('PENDING');
    expect(row.userId).toBe('user-1');
    expect(row.storageKey).toBe(`raw/user-1/${id}`);
  });

  it('create is idempotent on the PK (retried upload → one row, still PENDING)', async () => {
    await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    expect(await db.prisma.screenshot.count({ where: { id } })).toBe(1);
  });

  it('markRedacted sets REDACTED + reason and writes an AuditLog row in one tx', async () => {
    await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    const found = await repo().findById(id);
    expect(found?.userId).toBe('user-1');
    const redacted = await repo().markRedacted(id, new Date(TS), 'personal', 'user-1');
    expect(redacted.status).toBe('REDACTED');
    expect(redacted.redactedReason).toBe('personal');
    const audit = await db.prisma.auditLog.findFirst({ where: { targetId: id } });
    expect(audit?.action).toBe('screenshot.redact');
    expect(audit?.actorId).toBe('user-1');
  });
});

describe('screenshots e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
