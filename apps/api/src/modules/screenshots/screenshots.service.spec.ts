import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScreenshotsService } from './screenshots.service.js';
import type { ScreenshotsRepository, ScreenshotRow } from './screenshots.repository.js';
import type { MinioService } from '../../infra/storage/minio.service.js';
import type { QueueService } from '../../infra/queue/queue.module.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const USER: SessionUser = { id: 'user-1', role: 'EMPLOYEE', teamId: 'team-1' };
const META = { id: '019797a0-0000-7000-8000-0000000000d1', timestamp: '2026-07-16T10:00:00.000Z' };

function pendingRow(): ScreenshotRow {
  return {
    id: META.id,
    userId: 'user-1',
    timestamp: new Date(META.timestamp),
    storageKey: `raw/user-1/${META.id}`,
    thumbnailKey: null,
    blurred: false,
    status: 'PENDING',
    redactedReason: null,
    captureGroupId: null,
    displayIndex: null,
    displayCount: null,
  };
}

import type { ListScreenshotsQuery } from '@timetrack/contracts';

describe('ScreenshotsService.upload', () => {
  it('streams to raw/<sessionUser>/<id>, upserts PENDING, enqueues, returns the shot', async () => {
    const putStream = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(pendingRow());
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const svc = new ScreenshotsService(
      { create } as unknown as ScreenshotsRepository,
      { putStream } as unknown as MinioService,
      { enqueue } as unknown as QueueService,
    );

    const shot = await svc.upload(Readable.from([Buffer.from('img')]), META, USER);

    expect(putStream).toHaveBeenCalledWith(`raw/user-1/${META.id}`, expect.anything(), 'image/png');
    expect(create).toHaveBeenCalledWith(META, 'user-1', `raw/user-1/${META.id}`);
    expect(enqueue).toHaveBeenCalledWith('screenshot-process', expect.any(String), {
      id: META.id,
      timestamp: META.timestamp,
    });
    expect(shot.status).toBe('PENDING');
    expect(shot.id).toBe(META.id);
  });
});

describe('ScreenshotsService.list presigning', () => {
  function svcWith(
    rows: ScreenshotRow[],
    presign = vi.fn((k: string) => Promise.resolve(`signed:${k}`)),
  ) {
    return new ScreenshotsService(
      { listByUser: vi.fn().mockResolvedValue(rows) } as unknown as ScreenshotsRepository,
      { presignGet: presign } as unknown as MinioService,
      {} as unknown as QueueService,
    );
  }
  const q: ListScreenshotsQuery = { from: '2026-07-16T00:00:00Z', to: '2026-07-16T23:59:59Z' };

  it('READY row → url=signed thumb, fullUrl=signed raw', async () => {
    const row: ScreenshotRow = { ...pendingRow(), status: 'READY', thumbnailKey: 'thumb/user-1/x' };
    const shots = await svcWith([row]).list(q, USER);
    const shot = shots[0]!;
    expect(shot.url).toBe('signed:thumb/user-1/x');
    expect(shot.fullUrl).toBe(`signed:raw/user-1/${META.id}`);
  });

  it('READY THUMBNAIL_ONLY (no raw retained) → url set, fullUrl undefined', async () => {
    const row: ScreenshotRow = {
      ...pendingRow(),
      status: 'READY',
      thumbnailKey: 'thumb/user-1/x',
      storageKey: '', // raw deleted by worker under THUMBNAIL_ONLY
    };
    const shots = await svcWith([row]).list(q, USER);
    const shot = shots[0]!;
    expect(shot.url).toBe('signed:thumb/user-1/x');
    expect(shot.fullUrl).toBeUndefined();
  });

  it('PENDING and REDACTED rows carry no URLs', async () => {
    const pending: ScreenshotRow = pendingRow();
    const redacted: ScreenshotRow = { ...pendingRow(), status: 'REDACTED' };
    const shots = await svcWith([pending, redacted]).list(q, USER);
    const pendingShot = shots[0]!;
    const redactedShot = shots[1]!;
    expect(pendingShot.url).toBeUndefined();
    expect(pendingShot.fullUrl).toBeUndefined();
    expect(redactedShot.url).toBeUndefined();
    expect(redactedShot.fullUrl).toBeUndefined();
  });
});

describe('ScreenshotsService.redact', () => {
  const readyRow: ScreenshotRow = {
    ...pendingRow(),
    status: 'READY',
    thumbnailKey: `thumb/user-1/${META.id}`,
  };

  it('403 when the caller is not the owner (a manager cannot redact)', async () => {
    const svc = new ScreenshotsService(
      { findById: vi.fn().mockResolvedValue(readyRow) } as unknown as ScreenshotsRepository,
      {} as unknown as MinioService,
      {} as unknown as QueueService,
    );
    const manager: SessionUser = { id: 'mgr-1', role: 'MANAGER', teamId: 'team-1' };
    await expect(svc.redact(META.id, { reason: 'x' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 when no row exists for the id', async () => {
    const svc = new ScreenshotsService(
      { findById: vi.fn().mockResolvedValue(null) } as unknown as ScreenshotsRepository,
      {} as unknown as MinioService,
      {} as unknown as QueueService,
    );
    await expect(svc.redact(META.id, { reason: 'x' }, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('owner redacts → marks REDACTED, deletes raw + thumb objects, returns tombstone', async () => {
    const markRedacted = vi
      .fn()
      .mockResolvedValue({ ...readyRow, status: 'REDACTED', redactedReason: 'personal' });
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const svc = new ScreenshotsService(
      {
        findById: vi.fn().mockResolvedValue(readyRow),
        markRedacted,
      } as unknown as ScreenshotsRepository,
      { deleteObject } as unknown as MinioService,
      {} as unknown as QueueService,
    );
    const shot = await svc.redact(META.id, { reason: 'personal' }, USER);
    expect(shot.status).toBe('REDACTED');
    expect(shot.url).toBeUndefined();
    expect(deleteObject).toHaveBeenCalledWith(`raw/user-1/${META.id}`);
    expect(deleteObject).toHaveBeenCalledWith(`thumb/user-1/${META.id}`);
    expect(markRedacted).toHaveBeenCalledWith(META.id, readyRow.timestamp, 'personal', 'user-1');
  });
});
