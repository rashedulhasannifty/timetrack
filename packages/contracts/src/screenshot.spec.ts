import { describe, expect, it } from 'vitest';
import { UploadScreenshotMetaSchema, ScreenshotSchema } from './screenshot.js';

describe('UploadScreenshotMetaSchema', () => {
  it('accepts a UUID id + ISO timestamp', () => {
    const parsed = UploadScreenshotMetaSchema.parse({
      id: '019797a0-0000-7000-8000-0000000000a1',
      timestamp: '2026-07-16T10:00:00.000Z',
    });
    expect(parsed.id).toBe('019797a0-0000-7000-8000-0000000000a1');
  });

  it('rejects a non-UUID id', () => {
    expect(() =>
      UploadScreenshotMetaSchema.parse({ id: 'nope', timestamp: '2026-07-16T10:00:00Z' }),
    ).toThrow();
  });

  it('accepts multi-display grouping fields, coercing the multipart string numerics', () => {
    const parsed = UploadScreenshotMetaSchema.parse({
      id: '019797a0-0000-7000-8000-0000000000a1',
      timestamp: '2026-07-16T10:00:00.000Z',
      captureGroupId: '019797a0-0000-7000-8000-0000000000c1',
      displayIndex: '1',
      displayCount: '2',
    });
    expect(parsed.displayIndex).toBe(1);
    expect(parsed.displayCount).toBe(2);
  });

  /**
   * A Mac client built before multi-display capture sends only id + timestamp, and /v1 has to
   * keep accepting it — a shipped client cannot be rolled back. The absent numerics must stay
   * undefined rather than coercing to NaN.
   */
  it('accepts an upload with no grouping fields at all', () => {
    const parsed = UploadScreenshotMetaSchema.parse({
      id: '019797a0-0000-7000-8000-0000000000a1',
      timestamp: '2026-07-16T10:00:00.000Z',
    });
    expect(parsed.captureGroupId).toBeUndefined();
    expect(parsed.displayIndex).toBeUndefined();
    expect(parsed.displayCount).toBeUndefined();
  });

  it('rejects a displayIndex outside the supported display count', () => {
    expect(() =>
      UploadScreenshotMetaSchema.parse({
        id: '019797a0-0000-7000-8000-0000000000a1',
        timestamp: '2026-07-16T10:00:00.000Z',
        displayIndex: '99',
      }),
    ).toThrow();
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() =>
      UploadScreenshotMetaSchema.parse({
        id: '019797a0-0000-7000-8000-0000000000a1',
        timestamp: 'yesterday',
      }),
    ).toThrow();
  });
});

describe('ScreenshotSchema', () => {
  it('accepts an optional fullUrl', () => {
    const parsed = ScreenshotSchema.parse({
      id: '019797a0-0000-7000-8000-0000000000a1',
      userId: '019797a0-0000-7000-8000-0000000000b1',
      timestamp: '2026-07-16T10:00:00.000Z',
      storageKey: 'raw/u/1',
      thumbnailKey: 'thumb/u/1',
      blurred: false,
      status: 'READY',
      redactedReason: null,
      captureGroupId: '019797a0-0000-7000-8000-0000000000c1',
      displayIndex: 0,
      displayCount: 2,
      url: 'https://example.test/thumb',
      fullUrl: 'https://example.test/full',
    });
    expect(parsed.fullUrl).toBe('https://example.test/full');
  });

  /** Captures taken before multi-display support read back as a group of one. */
  it('accepts null grouping fields on a legacy row', () => {
    const parsed = ScreenshotSchema.parse({
      id: '019797a0-0000-7000-8000-0000000000a1',
      userId: '019797a0-0000-7000-8000-0000000000b1',
      timestamp: '2026-07-16T10:00:00.000Z',
      storageKey: 'raw/u/1',
      thumbnailKey: null,
      blurred: false,
      status: 'PENDING',
      redactedReason: null,
      captureGroupId: null,
      displayIndex: null,
      displayCount: null,
    });
    expect(parsed.captureGroupId).toBeNull();
  });
});
