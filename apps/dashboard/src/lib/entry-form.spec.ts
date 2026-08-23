import { describe, it, expect } from 'vitest';
import { parseEntryTimes, optionalText, optionalId, textField } from './entry-form';

describe('parseEntryTimes', () => {
  it('builds both instants from the APP_TIMEZONE day, not the runner clock', () => {
    // Dhaka is UTC+6, so 09:00 on 2026-08-24 is 03:00Z the same day.
    const r = parseEntryTimes('2026-08-24', '09:00', '17:30');
    expect(r).toEqual({
      ok: true,
      startTime: '2026-08-24T03:00:00.000Z',
      endTime: '2026-08-24T11:30:00.000Z',
    });
  });

  it('reads an end at or before the start as crossing midnight', () => {
    // A night shift, and the early-morning hours the approval week is anchored around.
    const r = parseEntryTimes('2026-08-24', '22:00', '02:00');
    expect(r).toEqual({
      ok: true,
      startTime: '2026-08-24T16:00:00.000Z',
      endTime: '2026-08-24T20:00:00.000Z',
    });
  });

  it('refuses a transposed pair as a typo rather than filing 19 hours', () => {
    const r = parseEntryTimes('2026-08-24', '14:00', '09:00');
    // Narrowed rather than matched loosely: `expect.stringContaining` is typed `any`, and the
    // union makes the real assertion available directly.
    if (r.ok) throw new Error('expected the transposed pair to be refused');
    expect(r.message).toContain('16 hours');
  });

  it('refuses a zero-length span', () => {
    expect(parseEntryTimes('2026-08-24', '09:00', '09:00')).toMatchObject({ ok: false });
  });

  it('refuses a bad day or a bad clock reading', () => {
    expect(parseEntryTimes('2026-02-30', '09:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '9:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '24:00', '10:00')).toMatchObject({ ok: false });
    expect(parseEntryTimes('2026-08-24', '09:60', '10:00')).toMatchObject({ ok: false });
  });

  it('accepts the edges of the clock', () => {
    expect(parseEntryTimes('2026-08-24', '00:00', '08:00').ok).toBe(true);
    expect(parseEntryTimes('2026-08-24', '15:59', '23:59').ok).toBe(true);
    // ...but a span covering nearly the whole clock is still a typo, not a shift.
    expect(parseEntryTimes('2026-08-24', '00:00', '23:59').ok).toBe(false);
  });
});

describe('optional field readers', () => {
  it('treats blank and whitespace as absent', () => {
    expect(optionalText('  ')).toBeUndefined();
    expect(optionalText('')).toBeUndefined();
    expect(optionalText(null)).toBeUndefined();
    expect(optionalText('  a note ')).toBe('a note');
  });

  it('reads a non-string field as absent rather than "[object File]"', () => {
    expect(textField(new File([], 'x.txt'))).toBe('');
    expect(textField(null)).toBe('');
    expect(textField('2026-08-24')).toBe('2026-08-24');
  });

  it('maps an unselected project to null, not an empty string', () => {
    expect(optionalId('')).toBeNull();
    expect(optionalId(null)).toBeNull();
    expect(optionalId('p1')).toBe('p1');
  });
});
