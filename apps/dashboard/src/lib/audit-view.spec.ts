import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@timetrack/contracts';
import { actorLabel, formatDiff, toIso, buildAuditParams } from './audit-view';

describe('actorLabel', () => {
  const base = {
    actorId: '019797a0-0000-7000-8000-0000000000b2',
    actorName: null,
    actorEmail: null,
  };
  it('labels the nil-UUID system actor "System"', () => {
    expect(actorLabel({ ...base, actorId: SYSTEM_ACTOR_ID })).toBe('System');
  });
  it('renders name + email when resolved', () => {
    expect(actorLabel({ ...base, actorName: 'Ada', actorEmail: 'ada@x.com' })).toBe(
      'Ada (ada@x.com)',
    );
  });
  it('renders name alone when email is null', () => {
    expect(actorLabel({ ...base, actorName: 'Ada' })).toBe('Ada');
  });
  it('falls back to the raw actorId when unresolved', () => {
    expect(actorLabel(base)).toBe(base.actorId);
  });
});

describe('formatDiff', () => {
  it('pretty-prints an object', () => {
    expect(formatDiff({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it('renders null/undefined as an em dash', () => {
    expect(formatDiff(null)).toBe('—');
    expect(formatDiff(undefined)).toBe('—');
  });
});

describe('toIso', () => {
  it('returns undefined for empty/absent input', () => {
    expect(toIso(undefined)).toBeUndefined();
    expect(toIso('')).toBeUndefined();
  });
  it('converts a date-only value to a Z-terminated ISO instant (start of day by default)', () => {
    // Date-only strings parse as UTC midnight per the ES spec — tz-stable.
    expect(toIso('2026-07-20')).toBe('2026-07-20T00:00:00.000Z');
    expect(toIso('2026-07-20', 'start')).toBe('2026-07-20T00:00:00.000Z');
  });
  it("maps a 'to' date to the last instant of that UTC day (inclusive-of-day)", () => {
    // So an lte comparison on the API includes every row of 2026-07-20, not just its midnight.
    expect(toIso('2026-07-20', 'end')).toBe('2026-07-20T23:59:59.999Z');
  });
  it('returns undefined for an unparseable value (either boundary)', () => {
    expect(toIso('not-a-date')).toBeUndefined();
    expect(toIso('not-a-date', 'end')).toBeUndefined();
  });
});

describe('buildAuditParams', () => {
  it('omits empty filters and includes only what is set', () => {
    expect(buildAuditParams({ targetType: 'user' }).toString()).toBe('targetType=user');
    expect(buildAuditParams({}).toString()).toBe('');
  });
  it('sets the cursor from the explicit arg, ignoring any cursor on the filters object', () => {
    const p = buildAuditParams({ targetType: 'user' }, 'abc');
    expect(p.get('cursor')).toBe('abc');
  });
  it('drops a null/absent cursor', () => {
    expect(buildAuditParams({ targetId: 'x' }, null).has('cursor')).toBe(false);
  });
});
