import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { TimeEntriesRepository } from '../src/modules/time-entries/time-entries.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import type { UpdateTimeEntry } from '@timetrack/contracts';

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

  function repo(): TimeEntriesRepository {
    return new TimeEntriesRepository(db.prisma as unknown as PrismaService);
  }

  function createDto(id: string, over: Partial<{ endTime: string | null; note: string }> = {}) {
    return {
      id,
      projectId: null,
      taskId: null,
      startTime: '2026-07-11T09:00:00Z',
      endTime: null,
      source: 'AUTO' as const,
      ...over,
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

  it('upsert is idempotent on the client id (double POST -> one row)', async () => {
    const user = await seedUser();
    const dto = createDto('019797a0-0000-7000-8000-0000000000a1');
    await repo().upsert(dto, user.id);
    await repo().upsert(dto, user.id); // retried offline batch
    expect(await db.prisma.timeEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('upsert rejects a second, different running entry with a 409', async () => {
    const user = await seedUser();
    await repo().upsert(createDto('019797a0-0000-7000-8000-0000000000a2'), user.id);
    await expect(
      repo().upsert(createDto('019797a0-0000-7000-8000-0000000000a3'), user.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findActiveByUser returns the open entry, or null when none is open', async () => {
    const user = await seedUser();
    expect(await repo().findActiveByUser(user.id)).toBeNull();

    await repo().upsert(createDto('019797a0-0000-7000-8000-0000000000a4'), user.id);
    const active = await repo().findActiveByUser(user.id);
    expect(active).toMatchObject({ id: '019797a0-0000-7000-8000-0000000000a4', endTime: null });

    // Close it; now nothing is active.
    await repo().upsert(
      createDto('019797a0-0000-7000-8000-0000000000a4', { endTime: '2026-07-11T10:00:00Z' }),
      user.id,
    );
    expect(await repo().findActiveByUser(user.id)).toBeNull();
  });

  it('findForEdit returns the serialized entry, or null when missing', async () => {
    const user = await seedUser();
    await repo().upsert(createDto('019797a0-0000-7000-8000-0000000000a5'), user.id);
    const found = await repo().findForEdit('019797a0-0000-7000-8000-0000000000a5');
    expect(found).toMatchObject({ userId: user.id, editedById: null, editedAt: null });
    expect(await repo().findForEdit('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('update applies changed fields, stamps editedBy/editedAt, and audits a before/after diff', async () => {
    const user = await seedUser();
    // Seed with a note already set, so the diff has non-null before/after (a cleaner
    // assertion than null-normalization, which the service handles separately).
    await repo().upsert(
      createDto('019797a0-0000-7000-8000-0000000000b1', {
        endTime: '2026-07-11T10:00:00Z',
        note: 'draft',
      }),
      user.id,
    );

    const after: UpdateTimeEntry = { note: 'client meeting' };
    const before: UpdateTimeEntry = { note: 'draft' };
    const updated = await repo().update(
      '019797a0-0000-7000-8000-0000000000b1',
      after,
      before,
      'mgr1',
    );

    expect(updated).toMatchObject({ note: 'client meeting', editedById: 'mgr1' });
    expect(updated.editedAt).not.toBeNull();

    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'time_entry', targetId: '019797a0-0000-7000-8000-0000000000b1' },
    });
    expect(audit?.action).toBe('time_entry.edit');
    expect(audit?.actorId).toBe('mgr1');
    expect(audit?.diff).toEqual({ before: { note: 'draft' }, after: { note: 'client meeting' } });
  });

  it('upsert-close leaves editedBy/editedAt null and writes NO audit row (normal op, not an edit)', async () => {
    const user = await seedUser();
    await repo().upsert(createDto('019797a0-0000-7000-8000-0000000000b2'), user.id); // open
    const closed = await repo().upsert(
      createDto('019797a0-0000-7000-8000-0000000000b2', { endTime: '2026-07-11T11:00:00Z' }),
      user.id,
    ); // close via the sync path, NOT an edit

    expect(closed.editedById).toBeNull();
    expect(closed.editedAt).toBeNull();
    const audit = await db.prisma.auditLog.count({
      where: { targetType: 'time_entry', targetId: '019797a0-0000-7000-8000-0000000000b2' },
    });
    expect(audit).toBe(0);
  });

  it('update mapping a reopen that collides with another open entry -> 409', async () => {
    const user = await seedUser();
    // One still-open entry...
    await repo().upsert(createDto('019797a0-0000-7000-8000-0000000000b3'), user.id);
    // ...and a closed one we then try to REOPEN (endTime -> null) for the same user.
    await repo().upsert(
      createDto('019797a0-0000-7000-8000-0000000000b4', { endTime: '2026-07-11T10:00:00Z' }),
      user.id,
    );

    await expect(
      repo().update(
        '019797a0-0000-7000-8000-0000000000b4',
        { endTime: null },
        { endTime: '2026-07-11T10:00:00Z' },
        'mgr1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a late open payload cannot re-open a closed entry (close is monotone)', async () => {
    const user = await seedUser();
    const id = '019797a0-0000-7000-8000-0000000000c1';

    // 1. The client opens the entry.
    await repo().upsert(createDto(id), user.id);

    // 2. The client closes it.
    const closed = await repo().upsert(createDto(id, { endTime: '2026-07-11T10:00:00Z' }), user.id);
    expect(closed.endTime).toBe('2026-07-11T10:00:00.000Z');

    // 3. A stale open payload arrives late (retry, slow network, queued heartbeat).
    const stale = await repo().upsert(createDto(id), user.id);

    // Without the fix this is null and the entry is wedged as permanently running.
    expect(stale.endTime).toBe('2026-07-11T10:00:00.000Z');
  });

  it('stamps heartbeatAt on every upsert', async () => {
    const user = await seedUser();
    const id = '019797a0-0000-7000-8000-0000000000c2';
    const before = new Date();

    await repo().upsert(createDto(id), user.id);

    const row = await db.prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    expect(row.heartbeatAt).not.toBeNull();
    expect(row.heartbeatAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('an upsert that omits note (e.g. a heartbeat re-POST) does not erase a stored note', async () => {
    const user = await seedUser();
    const id = '019797a0-0000-7000-8000-0000000000c3';

    // 1. The note is set (e.g. the client sent it on open, or a dashboard correction landed).
    await repo().upsert(createDto(id, { note: 'client call' }), user.id);

    // 2. A later payload omits `note` entirely, the way the 60s heartbeat re-POST does.
    const reheartbeat = await repo().upsert(createDto(id), user.id);

    // Without the fix this is undefined/null and the note is silently erased.
    expect(reheartbeat.note).toBe('client call');
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('time-entries e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
