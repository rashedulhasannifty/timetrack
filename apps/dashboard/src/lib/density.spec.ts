import { describe, it, expect } from 'vitest';
import { normalizeDensity, nextDensity } from './density';

describe('normalizeDensity', () => {
  it('passes through the two valid values', () => {
    expect(normalizeDensity('compact')).toBe('compact');
    expect(normalizeDensity('comfortable')).toBe('comfortable');
  });

  /**
   * localStorage is absent in private windows and holds whatever a previous version wrote,
   * so an unreadable value must fall back rather than setting data-density to garbage —
   * which would match neither CSS block and collapse every table to zero padding.
   */
  it('falls back to comfortable for anything else', () => {
    expect(normalizeDensity(null)).toBe('comfortable');
    expect(normalizeDensity('')).toBe('comfortable');
    expect(normalizeDensity('cosy')).toBe('comfortable');
  });
});

describe('nextDensity', () => {
  it('flips between the two', () => {
    expect(nextDensity('comfortable')).toBe('compact');
    expect(nextDensity('compact')).toBe('comfortable');
  });
});
