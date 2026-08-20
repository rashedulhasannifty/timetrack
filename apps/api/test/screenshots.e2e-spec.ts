import './test-env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { ConflictException } from '@nestjs/common';
import { ScreenshotsRepository } from '../src/modules/screenshots/screenshots.repository.js';
import { ScreenshotsService } from '../src/modules/screenshots/screenshots.service.js';
import { MinioService } from '../src/infra/storage/minio.service.js';
import type { QueueService } from '../src/infra/queue/queue.module.js';
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

  /**
   * Multi-display capture: one tick writes one row per attached display, all sharing a
   * captureGroupId. The grouping fields have to survive the round-trip through BOTH the write
   * and the list read — an earlier version of this repository kept a second, inline select list
   * for reads, where a newly added column silently vanished.
   */
  it('round-trips the capture group across a write and a list read', async () => {
    const groupId = '019797a0-0000-7000-8000-0000000000f0';
    const left = '019797a0-0000-7000-8000-0000000000f1';
    const right = '019797a0-0000-7000-8000-0000000000f2';
    await repo().create(
      { id: left, timestamp: TS, captureGroupId: groupId, displayIndex: 0, displayCount: 2 },
      'user-1',
      `raw/user-1/${left}`,
    );
    await repo().create(
      { id: right, timestamp: TS, captureGroupId: groupId, displayIndex: 1, displayCount: 2 },
      'user-1',
      `raw/user-1/${right}`,
    );

    const rows = await repo().listByUser(
      'user-1',
      new Date('2026-07-16T00:00:00.000Z'),
      new Date('2026-07-17T00:00:00.000Z'),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.captureGroupId)).toEqual([groupId, groupId]);
    // Displays of one tick share a timestamp, so ordering falls to displayIndex — the main
    // display first, so the same monitor keeps its place between groups.
    expect(rows.map((r) => r.displayIndex)).toEqual([0, 1]);
    expect(rows[0]?.displayCount).toBe(2);
  });

  /**
   * A Mac client older than multi-display capture sends no grouping fields at all, and /v1 has
   * to keep accepting it. Those rows read back as nulls — a group of one, which is exactly what
   * a single-display capture always was.
   */
  it('stores nulls for an upload with no grouping fields (older client)', async () => {
    const row = await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    expect(row.captureGroupId).toBeNull();
    expect(row.displayIndex).toBeNull();
    expect(row.displayCount).toBeNull();
  });

  it('rejects a same-PK upload from a different user (409), leaves the original row untouched', async () => {
    await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    await expect(
      repo().create({ id, timestamp: TS }, 'user-2', `raw/user-2/${id}`),
    ).rejects.toBeInstanceOf(ConflictException);
    const row = await db.prisma.screenshot.findUnique({ where: { id_timestamp: { id, timestamp: new Date(TS) } } });
    expect(row?.userId).toBe('user-1');
    expect(row?.storageKey).toBe(`raw/user-1/${id}`);
  });

  it('rejects a re-upload onto an already-REDACTED row (409), leaves it REDACTED', async () => {
    await repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`);
    await repo().markRedacted(id, new Date(TS), 'personal', 'user-1');
    await expect(
      repo().create({ id, timestamp: TS }, 'user-1', `raw/user-1/${id}`),
    ).rejects.toBeInstanceOf(ConflictException);
    const row = await db.prisma.screenshot.findUnique({ where: { id_timestamp: { id, timestamp: new Date(TS) } } });
    expect(row?.status).toBe('REDACTED');
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

describe.runIf(RUN_E2E)('screenshots upload — real Postgres + MinIO', () => {
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

  it('streams the image to storage and writes a PENDING row', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const svc = new ScreenshotsService(
      new ScreenshotsRepository(db.prisma as unknown as PrismaService),
      storage,
      { enqueue } as unknown as QueueService,
    );
    const shot = await svc.upload(
      Readable.from([Buffer.from('PNGDATA')]),
      { id: '019797a0-0000-7000-8000-0000000000e9', timestamp: TS },
      { id: 'user-9', role: 'EMPLOYEE', teamId: 'team-9' },
    );
    expect(shot.status).toBe('PENDING');
    expect(shot.storageKey).toBe('raw/user-9/019797a0-0000-7000-8000-0000000000e9');
    const bytes = await fetch(await storage.presignGet(shot.storageKey)).then((r) => r.text());
    expect(bytes).toBe('PNGDATA');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('owner redact deletes objects, writes audit, leaves a tombstone row', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const svc = new ScreenshotsService(
      new ScreenshotsRepository(db.prisma as unknown as PrismaService),
      storage,
      { enqueue } as unknown as QueueService,
    );
    const shotId = '019797a0-0000-7000-8000-0000000000ea';
    await svc.upload(
      Readable.from([Buffer.from('IMG')]),
      { id: shotId, timestamp: TS },
      {
        id: 'user-9',
        role: 'EMPLOYEE',
        teamId: 'team-9',
      },
    );
    const redacted = await svc.redact(
      shotId,
      { reason: 'personal' },
      {
        id: 'user-9',
        role: 'EMPLOYEE',
        teamId: 'team-9',
      },
    );
    expect(redacted.status).toBe('REDACTED');
    const gone = await fetch(await storage.presignGet(`raw/user-9/${shotId}`));
    expect(gone.status).toBe(404);
    expect(await db.prisma.auditLog.count({ where: { targetId: shotId } })).toBe(1);
    expect(await db.prisma.screenshot.count({ where: { id: shotId } })).toBe(1); // tombstone remains
  });

  it('redact is idempotent: a second redact by the owner is a no-op returning the tombstone', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const svc = new ScreenshotsService(
      new ScreenshotsRepository(db.prisma as unknown as PrismaService),
      storage,
      { enqueue } as unknown as QueueService,
    );
    const shotId = '019797a0-0000-7000-8000-0000000000eb';
    const owner = { id: 'user-9', role: 'EMPLOYEE' as const, teamId: 'team-9' };
    await svc.upload(Readable.from([Buffer.from('IMG')]), { id: shotId, timestamp: TS }, owner);
    await svc.redact(shotId, { reason: 'personal' }, owner);

    const second = await svc.redact(shotId, { reason: 'personal, again' }, owner);

    expect(second.status).toBe('REDACTED');
    expect(second.redactedReason).toBe('personal'); // unchanged — no-op, not re-redacted
    expect(await db.prisma.auditLog.count({ where: { targetId: shotId } })).toBe(1);
  });
});
