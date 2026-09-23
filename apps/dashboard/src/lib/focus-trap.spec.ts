import { describe, it, expect } from 'vitest';
import { nextFocusTarget } from './focus-trap';

describe('nextFocusTarget', () => {
  it('returns null when the panel has nothing focusable', () => {
    expect(nextFocusTarget([], null, false)).toBeNull();
    expect(nextFocusTarget([], null, true)).toBeNull();
  });

  it('starts at the first item on Tab when nothing is focused yet', () => {
    expect(nextFocusTarget(['a', 'b', 'c'], null, false)).toBe('a');
  });

  it('starts at the last item on Shift+Tab when nothing is focused yet', () => {
    expect(nextFocusTarget(['a', 'b', 'c'], null, true)).toBe('c');
  });

  it('treats a current element outside the list the same as nothing focused', () => {
    expect(nextFocusTarget(['a', 'b', 'c'], 'z', false)).toBe('a');
    expect(nextFocusTarget(['a', 'b', 'c'], 'z', true)).toBe('c');
  });

  it('advances forward and wraps from the last item to the first', () => {
    expect(nextFocusTarget(['a', 'b', 'c'], 'a', false)).toBe('b');
    expect(nextFocusTarget(['a', 'b', 'c'], 'b', false)).toBe('c');
    expect(nextFocusTarget(['a', 'b', 'c'], 'c', false)).toBe('a');
  });

  it('advances backward and wraps from the first item to the last', () => {
    expect(nextFocusTarget(['a', 'b', 'c'], 'c', true)).toBe('b');
    expect(nextFocusTarget(['a', 'b', 'c'], 'b', true)).toBe('a');
    expect(nextFocusTarget(['a', 'b', 'c'], 'a', true)).toBe('c');
  });

  it('wraps a single focusable element to itself in either direction', () => {
    expect(nextFocusTarget(['only'], 'only', false)).toBe('only');
    expect(nextFocusTarget(['only'], 'only', true)).toBe('only');
  });
});
