import { describe, it, expect } from 'vitest';
import { durationToSeconds } from './token.util.js';

describe('durationToSeconds', () => {
  it('parses each supported unit', () => {
    expect(durationToSeconds('45s')).toBe(45);
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('2h')).toBe(7200);
    expect(durationToSeconds('30d')).toBe(2_592_000);
  });

  it('rejects malformed durations', () => {
    expect(() => durationToSeconds('15')).toThrow();
    expect(() => durationToSeconds('1w')).toThrow();
    expect(() => durationToSeconds('')).toThrow();
  });
});
