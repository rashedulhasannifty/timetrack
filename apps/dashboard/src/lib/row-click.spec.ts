import { describe, it, expect } from 'vitest';
import { startedOnInteractive } from './row-click';

/** Minimal `.closest`-carrying stand-in for a DOM node, since vitest here is node-env. */
function fakeElement(matches: boolean): EventTarget {
  return { closest: () => (matches ? {} : null) } as unknown as EventTarget;
}

describe('startedOnInteractive', () => {
  it('is false when the click target is null', () => {
    expect(startedOnInteractive(null)).toBe(false);
  });

  it('is false for a target with no closest() — a Text node, not an Element', () => {
    expect(startedOnInteractive({} as unknown as EventTarget)).toBe(false);
  });

  it('is false when closest() finds no interactive ancestor', () => {
    expect(startedOnInteractive(fakeElement(false))).toBe(false);
  });

  it('is true when closest() finds an interactive ancestor (button, link, form control, etc.)', () => {
    expect(startedOnInteractive(fakeElement(true))).toBe(true);
  });
});
