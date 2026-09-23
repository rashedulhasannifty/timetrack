import { describe, it, expect } from 'vitest';
import { sparklinePath } from './sparkline';

describe('sparklinePath', () => {
  it('returns nothing for fewer than two points', () => {
    expect(sparklinePath([], 60, 16)).toBe('');
    expect(sparklinePath([5], 60, 16)).toBe('');
  });

  it('spans the full width from first to last point', () => {
    const d = sparklinePath([0, 10], 60, 16);
    expect(d.startsWith('M 0')).toBe(true);
    expect(d).toContain('L 60');
  });

  /** y is inverted: the largest value must sit at the TOP of the box (y=0). */
  it('puts the maximum at the top and the minimum at the bottom', () => {
    const d = sparklinePath([0, 10], 60, 16);
    expect(d).toBe('M 0 16 L 60 0');
  });

  /**
   * A flat series has no range to normalise against. Dividing by a zero range would
   * emit NaN and silently blank the SVG, so it must pin to the vertical middle.
   */
  it('draws a flat series through the middle instead of emitting NaN', () => {
    const d = sparklinePath([7, 7, 7], 60, 16);
    expect(d).not.toContain('NaN');
    expect(d).toBe('M 0 8 L 30 8 L 60 8');
  });

  it('spaces points evenly across the width', () => {
    expect(sparklinePath([0, 5, 10], 100, 10)).toBe('M 0 10 L 50 5 L 100 0');
  });
});
