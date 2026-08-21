import { describe, expect, it } from 'vitest';
import { decidePlacement } from './decide-placement';

const VIEWPORT = { width: 1440, height: 900 };
const POPOVER = { width: 220, height: 120 };

/** A Decide button 60px wide, right-aligned in the table at x=1200. */
const button = (top: number) => ({ top, bottom: top + 26, left: 1140, right: 1200 });

describe('decidePlacement', () => {
  it('opens below the button, right-aligned to it', () => {
    const p = decidePlacement({ button: button(300), popover: POPOVER, viewport: VIEWPORT });
    expect(p.side).toBe('below');
    expect(p.top).toBe(300 + 26 + 8); // button bottom + gap
    expect(p.left).toBe(1200 - 220); // right edge flush with the button's
  });

  /**
   * THE REPORTED BUG. On the last row — or the only row — there is nothing below for the popover
   * to open into, and the card's `overflow-hidden` cropped it. The fix is positioning it fixed;
   * this is the other half, flipping it above so it stays on screen rather than under the fold.
   */
  it('flips above the button when there is no room below', () => {
    const p = decidePlacement({ button: button(860), popover: POPOVER, viewport: VIEWPORT });
    expect(p.side).toBe('above');
    expect(p.top).toBe(860 - 8 - 120); // button top - gap - height
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it('stays below when it still fits, rather than flipping eagerly', () => {
    // bottom 726 + gap 8 + height 120 = 854, inside the 892 limit — so it must NOT flip.
    // (At top=750 it genuinely does not fit and the test above covers that.)
    const p = decidePlacement({ button: button(700), popover: POPOVER, viewport: VIEWPORT });
    expect(p.side).toBe('below');
    expect(p.top + POPOVER.height).toBeLessThanOrEqual(VIEWPORT.height - 8);
  });

  /** A button near the top has no room above it, so it must not flip into the chrome. */
  it('does not flip above when there is no room there either', () => {
    const tiny = { width: 1440, height: 200 };
    const p = decidePlacement({ button: button(60), popover: POPOVER, viewport: tiny });
    expect(p.side).toBe('below');
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  /** Taller than the viewport: clamped on screen rather than jumping somewhere unrelated. */
  it('clamps a popover taller than the viewport instead of flinging it off screen', () => {
    const p = decidePlacement({
      button: button(400),
      popover: { width: 220, height: 1200 },
      viewport: VIEWPORT,
    });
    expect(p.top).toBe(8);
  });

  /** A button close to the left edge would put a right-aligned popover off screen. */
  it('keeps the popover inside the left edge', () => {
    const p = decidePlacement({
      button: { top: 300, bottom: 326, left: 20, right: 80 },
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    expect(p.left).toBe(8); // 80 - 220 = -140 would have been off screen
  });

  it('keeps the popover inside the right edge', () => {
    const p = decidePlacement({
      button: { top: 300, bottom: 326, left: 1400, right: 1438 },
      popover: POPOVER,
      viewport: VIEWPORT,
    });
    expect(p.left + POPOVER.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });
});
