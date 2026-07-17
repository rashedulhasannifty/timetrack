import { describe, it, expect } from 'vitest';
import type { Screenshot } from '@timetrack/contracts';
import { tileMode } from './screenshot-view';

const base: Screenshot = {
  id: '019f6ffe-910f-70e7-a56d-3ee574d99d7e',
  userId: '019f6fe4-06bb-755d-b9b8-ebbfc1a77159',
  timestamp: '2026-07-17T12:13:02.000Z',
  storageKey: 'raw/u/i',
  thumbnailKey: null,
  blurred: false,
  status: 'PENDING',
  redactedReason: null,
};

describe('tileMode', () => {
  it('READY with a presigned url → redactable', () => {
    expect(tileMode({ ...base, status: 'READY', url: 'http://minio/x' })).toBe('redactable');
  });
  it('REDACTED → redacted', () => {
    expect(tileMode({ ...base, status: 'REDACTED', redactedReason: 'reason' })).toBe('redacted');
  });
  it('PENDING → pending', () => {
    expect(tileMode({ ...base, status: 'PENDING' })).toBe('pending');
  });
  it('READY without a url → pending (nothing to redact yet)', () => {
    expect(tileMode({ ...base, status: 'READY' })).toBe('pending');
  });
});
