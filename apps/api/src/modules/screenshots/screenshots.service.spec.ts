import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
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
  };
}

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
