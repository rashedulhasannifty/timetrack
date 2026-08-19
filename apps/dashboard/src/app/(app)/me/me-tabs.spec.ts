import { describe, it, expect } from 'vitest';
import { resolveMePanel, ME_PANELS } from './MeTabs';

describe('resolveMePanel', () => {
  it('accepts every panel it advertises', () => {
    for (const p of ME_PANELS) expect(resolveMePanel(p)).toBe(p);
  });

  it('falls back to the timeline for a missing panel', () => {
    expect(resolveMePanel(undefined)).toBe('timeline');
  });

  it('falls back rather than trusting an arbitrary query value', () => {
    // ?panel= is user-controlled; an unknown value must not render a blank page.
    expect(resolveMePanel('nope')).toBe('timeline');
    expect(resolveMePanel('')).toBe('timeline');
    expect(resolveMePanel('__proto__')).toBe('timeline');
    expect(resolveMePanel('Idle')).toBe('timeline'); // case-sensitive by design
  });
});
