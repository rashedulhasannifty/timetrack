import { describe, expect, it } from 'vitest';
import {
  APP_TIMEZONE,
  clockOf,
  dayOf,
  dayStartInstant,
  isValidDay,
  monthStartDay,
  shiftDay,
  weekStartDay,
} from './time.js';

describe('APP_TIMEZONE', () => {
  it('is Dhaka', () => {
    expect(APP_TIMEZONE).toBe('Asia/Dhaka');
  });
});

describe('dayOf', () => {
  // The whole point of this slice: these two instants are the SAME UTC day
  // (2026-08-19) but DIFFERENT Dhaka days. Today's code buckets them together.
  it('puts 23:30 Dhaka on that Dhaka day', () => {
    // 2026-08-19T17:30Z === 2026-08-19 23:30 Dhaka
    expect(dayOf(new Date('2026-08-19T17:30:00.000Z'))).toBe('2026-08-19');
  });

  it('puts 00:30 Dhaka on the NEXT Dhaka day', () => {
    // 2026-08-19T18:30Z === 2026-08-20 00:30 Dhaka
    expect(dayOf(new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('treats 18:00Z exactly as the start of the next Dhaka day', () => {
    expect(dayOf(new Date('2026-08-19T18:00:00.000Z'))).toBe('2026-08-20');
    expect(dayOf(new Date('2026-08-19T17:59:59.999Z'))).toBe('2026-08-19');
  });
});

describe('dayStartInstant', () => {
  it('returns the UTC instant of Dhaka midnight', () => {
    expect(dayStartInstant('2026-08-20').toISOString()).toBe('2026-08-19T18:00:00.000Z');
  });

  it('round-trips with dayOf', () => {
    for (const day of ['2026-01-01', '2026-08-20', '2026-12-31']) {
      expect(dayOf(dayStartInstant(day))).toBe(day);
    }
  });

  it('the last millisecond before the next day still belongs to this day', () => {
    const nextStart = dayStartInstant('2026-08-21').getTime();
    expect(dayOf(new Date(nextStart - 1))).toBe('2026-08-20');
  });
});

describe('shiftDay', () => {
  it('moves forward and backward', () => {
    expect(shiftDay('2026-08-20', 1)).toBe('2026-08-21');
    expect(shiftDay('2026-08-20', -1)).toBe('2026-08-19');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('throws on malformed or impossible days rather than returning a wrong label', () => {
    // Number('') is 0, not NaN — a bare Number.isFinite guard lets these through silently.
    expect(() => shiftDay('--', 0)).toThrow(RangeError);
    expect(() => shiftDay('-2026-08-20', 0)).toThrow(RangeError);
    expect(() => shiftDay('2026-02-30', 0)).toThrow(RangeError);
    expect(() => shiftDay('', 0)).toThrow(RangeError);
  });
});

describe('clockOf', () => {
  it('renders Dhaka wall-clock time in 24-hour form', () => {
    expect(clockOf(new Date('2026-08-19T17:30:00.000Z'))).toBe('23:30');
    expect(clockOf(new Date('2026-08-19T18:30:00.000Z'))).toBe('00:30');
  });

  it('renders Dhaka midnight as 00:00, never 24:00', () => {
    expect(clockOf(new Date('2026-08-19T18:00:00.000Z'))).toBe('00:00');
  });
});

describe('isValidDay', () => {
  it('accepts a real calendar day', () => {
    expect(isValidDay('2026-08-20')).toBe(true);
  });

  it('rejects malformed or impossible days', () => {
    expect(isValidDay('2026-8-20')).toBe(false);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('not-a-day')).toBe(false);
    expect(isValidDay('')).toBe(false);
  });
});

describe('weekStartDay', () => {
  it('returns the day itself for a Monday', () => {
    expect(weekStartDay('2026-08-17')).toBe('2026-08-17'); // a Monday
  });

  it('walks back to Monday from mid-week', () => {
    expect(weekStartDay('2026-08-21')).toBe('2026-08-17'); // Friday → Monday
  });

  /** Sunday is the LAST day of a Monday-start week, not the first. Off-by-one here would put
   *  Sunday's work in next week and disagree with the approvals period. */
  it('treats Sunday as the end of the week it closes, not the start of the next', () => {
    expect(weekStartDay('2026-08-23')).toBe('2026-08-17');
    expect(weekStartDay('2026-08-24')).toBe('2026-08-24'); // the following Monday
  });

  it('crosses a month boundary backwards', () => {
    expect(weekStartDay('2026-09-02')).toBe('2026-08-31');
  });

  it('rejects a malformed day rather than inventing one', () => {
    expect(() => weekStartDay('2026-02-30')).toThrow(RangeError);
  });
});

describe('monthStartDay', () => {
  it('returns the first of the month', () => {
    expect(monthStartDay('2026-08-21')).toBe('2026-08-01');
    expect(monthStartDay('2026-08-01')).toBe('2026-08-01');
  });

  it('rejects a malformed day', () => {
    expect(() => monthStartDay('nope')).toThrow(RangeError);
  });
});
