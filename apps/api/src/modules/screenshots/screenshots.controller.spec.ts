import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ScreenshotsController } from './screenshots.controller.js';
import type { ScreenshotsService } from './screenshots.service.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const USER: SessionUser = { id: 'user-1', role: 'EMPLOYEE', teamId: 'team-1' };
const ID = '019797a0-0000-7000-8000-0000000000d1';
const TS = '2026-07-16T10:00:00.000Z';

function fakeReq(part: unknown) {
  return { file: vi.fn().mockResolvedValue(part) } as unknown as Parameters<
    ScreenshotsController['upload']
  >[0];
}

function pngPart(fields: Record<string, { value: string }>) {
  return {
    file: Readable.from([Buffer.from('img')]),
    mimetype: 'image/png',
    fields,
  };
}

describe('ScreenshotsController.upload', () => {
  it('extracts id/timestamp fields, forwards the stream, returns the service result', async () => {
    const upload = vi.fn().mockResolvedValue({ id: ID, status: 'PENDING' });
    const controller = new ScreenshotsController({ upload } as unknown as ScreenshotsService);
    const part = pngPart({ id: { value: ID }, timestamp: { value: TS } });
    const res = await controller.upload(fakeReq(part), USER);
    expect(upload).toHaveBeenCalledWith(part.file, { id: ID, timestamp: TS }, USER);
    expect(res.status).toBe('PENDING');
  });

  /**
   * Multi-display capture sends three more text fields. They are picked out by name, so a typo
   * here would silently drop the grouping and every capture would read as its own group — a
   * failure that looks exactly like working software.
   */
  it('forwards the capture group fields, coercing the multipart string numerics', async () => {
    const upload = vi.fn().mockResolvedValue({ id: ID, status: 'PENDING' });
    const controller = new ScreenshotsController({ upload } as unknown as ScreenshotsService);
    const groupId = '019797a0-0000-7000-8000-0000000000f0';
    const part = pngPart({
      id: { value: ID },
      timestamp: { value: TS },
      captureGroupId: { value: groupId },
      displayIndex: { value: '1' },
      displayCount: { value: '2' },
    });

    await controller.upload(fakeReq(part), USER);

    expect(upload).toHaveBeenCalledWith(
      part.file,
      { id: ID, timestamp: TS, captureGroupId: groupId, displayIndex: 1, displayCount: 2 },
      USER,
    );
  });

  /**
   * A Mac client older than multi-display capture sends none of them, and /v1 cannot break for a
   * client that is already shipped and cannot be rolled back.
   */
  it('accepts an upload from a client that sends no capture group at all', async () => {
    const upload = vi.fn().mockResolvedValue({ id: ID, status: 'PENDING' });
    const controller = new ScreenshotsController({ upload } as unknown as ScreenshotsService);
    const part = pngPart({ id: { value: ID }, timestamp: { value: TS } });

    await controller.upload(fakeReq(part), USER);

    expect(upload).toHaveBeenCalledWith(part.file, { id: ID, timestamp: TS }, USER);
  });

  it('rejects a missing file part', async () => {
    const controller = new ScreenshotsController({
      upload: vi.fn(),
    } as unknown as ScreenshotsService);
    await expect(controller.upload(fakeReq(undefined), USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a non-image mimetype', async () => {
    const controller = new ScreenshotsController({
      upload: vi.fn(),
    } as unknown as ScreenshotsService);
    const part = {
      file: Readable.from([]),
      mimetype: 'application/pdf',
      fields: { id: { value: ID }, timestamp: { value: TS } },
    };
    await expect(controller.upload(fakeReq(part), USER)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects bad metadata (non-UUID id) with 422/400', async () => {
    const controller = new ScreenshotsController({
      upload: vi.fn(),
    } as unknown as ScreenshotsService);
    const part = pngPart({ id: { value: 'nope' }, timestamp: { value: TS } });
    await expect(controller.upload(fakeReq(part), USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('cleans up and rejects a truncated (mid-stream cutoff) upload', async () => {
    const upload = vi.fn().mockResolvedValue({ id: ID, status: 'PENDING' });
    const deleteForTruncatedUpload = vi.fn().mockResolvedValue(undefined);
    const controller = new ScreenshotsController({
      upload,
      deleteForTruncatedUpload,
    } as unknown as ScreenshotsService);
    const fileStream = Readable.from([Buffer.from('img')]) as Readable & { truncated: boolean };
    fileStream.truncated = true;
    const part = {
      file: fileStream,
      mimetype: 'image/png',
      fields: { id: { value: ID }, timestamp: { value: TS } },
    };
    await expect(controller.upload(fakeReq(part), USER)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(deleteForTruncatedUpload).toHaveBeenCalledWith({ id: ID, timestamp: TS }, USER);
  });
});
