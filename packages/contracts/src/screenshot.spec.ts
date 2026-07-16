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
      url: 'https://example.test/thumb',
      fullUrl: 'https://example.test/full',
    });
    expect(parsed.fullUrl).toBe('https://example.test/full');
  });
});
