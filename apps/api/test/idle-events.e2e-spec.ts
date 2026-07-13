import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IdleEventsRepository } from '../src/modules/idle-events/idle-events.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import type { IdleEvent } from '@timetrack/contracts';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('idle-events repository — real Postgres', () => {
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

  function repo(): IdleEventsRepository {
    return new IdleEventsRepository(db.prisma as unknown as PrismaService);
  }

  function event(id: string, over: Partial<IdleEvent> = {}): IdleEvent {
    return {
      id,
      startTime: '2026-07-11T09:00:00Z',
      endTime: '2026-07-11T09:05:00Z',
      resolvedAction: 'DISCARDED',
      ...over,
    };
  }

  it('stores an idle event attributed to the user and echoes id + action', async () => {
    const id = '019797a0-0000-7000-8000-0000000000e1';
    const stored = await repo().upsert(event(id), 'u1');
    expect(stored).toEqual({ id, resolvedAction: 'DISCARDED' });

    const row = await db.prisma.idleEvent.findUnique({ where: { id } });
    expect(row?.userId).toBe('u1');
    expect(row?.resolvedAction).toBe('DISCARDED');
  });

  it('upsert is idempotent on the client id (double drain -> one row)', async () => {
    const e = event('019797a0-0000-7000-8000-0000000000e2');
    await repo().upsert(e, 'u1');
    await repo().upsert(e, 'u1'); // retried offline drain
    expect(await db.prisma.idleEvent.count({ where: { id: e.id } })).toBe(1);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('idle-events e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
