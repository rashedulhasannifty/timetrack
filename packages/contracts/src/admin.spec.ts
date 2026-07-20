import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  SYSTEM_ACTOR_ID,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  AuditLogListItemSchema,
  AuditLogPageSchema,
} from './admin.js';

describe('SYSTEM_ACTOR_ID', () => {
  it('is the nil UUID and satisfies the audit-entry actorId schema', () => {
    expect(SYSTEM_ACTOR_ID).toBe('00000000-0000-0000-0000-000000000000');
    // AuditLogEntrySchema.actorId is z.uuid(); a system row must pass it.
    expect(() => z.uuid().parse(SYSTEM_ACTOR_ID)).not.toThrow();
    const entry = {
      id: '019797a0-0000-7000-8000-0000000000a1',
      actorId: SYSTEM_ACTOR_ID,
      action: 'retention.cleanup',
      targetType: 'system',
      targetId: 'retention',
      diff: null,
      timestamp: '2026-07-20T03:20:00.000Z',
    };
    expect(() => AuditLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('AuditLogQuerySchema pagination', () => {
  it('defaults limit to 50 when absent', () => {
    expect(AuditLogQuerySchema.parse({}).limit).toBe(50);
  });
  it('coerces a string limit (query params are strings)', () => {
    expect(AuditLogQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });
  it('rejects a limit over 100', () => {
    expect(() => AuditLogQuerySchema.parse({ limit: '101' })).toThrow();
  });
  it('rejects a limit below 1', () => {
    expect(() => AuditLogQuerySchema.parse({ limit: '0' })).toThrow();
  });
  it('accepts a uuid cursor and rejects a non-uuid', () => {
    const id = '019797a0-0000-7000-8000-0000000000a1';
    expect(AuditLogQuerySchema.parse({ cursor: id }).cursor).toBe(id);
    expect(() => AuditLogQuerySchema.parse({ cursor: 'not-a-uuid' })).toThrow();
  });
});

describe('AuditLogListItemSchema + AuditLogPageSchema', () => {
  const item = {
    id: '019797a0-0000-7000-8000-0000000000a1',
    actorId: '019797a0-0000-7000-8000-0000000000b2',
    action: 'project.create',
    targetType: 'project',
    targetId: 'p1',
    diff: { name: 'X' },
    timestamp: '2026-07-20T03:20:00.000Z',
    actorName: 'Ada',
    actorEmail: 'ada@x.com',
  };
  it('accepts an item with a resolved actor identity', () => {
    expect(() => AuditLogListItemSchema.parse(item)).not.toThrow();
  });
  it('accepts null actorName/actorEmail (unresolved actor)', () => {
    expect(() =>
      AuditLogListItemSchema.parse({ ...item, actorName: null, actorEmail: null }),
    ).not.toThrow();
  });
  it('accepts a page with a uuid nextCursor and with null', () => {
    expect(() => AuditLogPageSchema.parse({ items: [item], nextCursor: item.id })).not.toThrow();
    expect(() => AuditLogPageSchema.parse({ items: [], nextCursor: null })).not.toThrow();
  });
});
