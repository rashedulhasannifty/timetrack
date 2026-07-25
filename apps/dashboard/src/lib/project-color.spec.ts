import { describe, it, expect } from 'vitest';
import { projectColor, PROJECT_PALETTE } from './project-color';

describe('projectColor', () => {
  it('is deterministic: same id → same color', () => {
    const a = projectColor('018f9c1e-0000-7000-8000-000000000001');
    const b = projectColor('018f9c1e-0000-7000-8000-000000000001');
    expect(a).toBe(b);
  });

  it('always returns a palette member', () => {
    for (let i = 0; i < 50; i++) {
      expect(PROJECT_PALETTE).toContain(projectColor(`id-${i}`));
    }
  });

  it('spreads across the palette (not all one color)', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `project-${i}`);
    const distinct = new Set(ids.map(projectColor));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('handles the empty string without throwing', () => {
    expect(PROJECT_PALETTE).toContain(projectColor(''));
  });
});
