import { describe, expect, it } from 'vitest';
import { dhakaWindow, previousDhakaDay } from './rollup-daily.util.js';

describe('dhakaWindow', () => {
  it('brackets the Dhaka day with UTC instants', () => {
    const w = dhakaWindow('2026-08-20');
    expect(w.from.toISOString()).toBe('2026-08-19T18:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-08-20T18:00:00.000Z');
  });

  it('stores the day LABEL as UTC midnight, not the window start', () => {
    // @db.Date takes the UTC date part. Storing the window start would persist 2026-08-19.
    const w = dhakaWindow('2026-08-20');
    expect(w.dayLabel.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(w.dayLabel.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('spans exactly 24 hours', () => {
    const w = dhakaWindow('2026-08-20');
    expect(w.to.getTime() - w.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('previousDhakaDay', () => {
  it('returns the Dhaka day before the one containing now', () => {
    // 2026-08-19T18:30Z is already 2026-08-20 in Dhaka, so the previous day is 2026-08-19.
    expect(previousDhakaDay(new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-19');
  });

  it('is still on the earlier day just before the Dhaka boundary', () => {
    // 2026-08-19T17:30Z is 2026-08-19 in Dhaka, so the previous day is 2026-08-18.
    expect(previousDhakaDay(new Date('2026-08-19T17:30:00.000Z'))).toBe('2026-08-18');
  });
});
