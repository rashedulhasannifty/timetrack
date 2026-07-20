import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SYSTEM_ACTOR_ID, AuditLogEntrySchema } from './admin.js';

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
