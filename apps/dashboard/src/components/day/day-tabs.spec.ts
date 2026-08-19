import { describe, it, expect } from 'vitest';
import { resolveDayPanel, DAY_PANELS } from './DayTabs';

describe('resolveDayPanel', () => {
  it('accepts every panel it advertises', () => {
    for (const p of DAY_PANELS) expect(resolveDayPanel(p)).toBe(p);
  });

  it('falls back to the timeline for a missing panel', () => {
    expect(resolveDayPanel(undefined)).toBe('timeline');
  });

  it('falls back rather than trusting an arbitrary query value', () => {
    // ?panel= is user-controlled; an unknown value must not render a blank page.
    expect(resolveDayPanel('nope')).toBe('timeline');
    expect(resolveDayPanel('')).toBe('timeline');
    expect(resolveDayPanel('__proto__')).toBe('timeline');
    expect(resolveDayPanel('Idle')).toBe('timeline'); // case-sensitive by design
  });
});
