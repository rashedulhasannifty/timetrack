export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Which side of the button it ended up on — exposed so a test can assert the flip. */
  side: 'below' | 'above';
}

/**
 * Where the Decide popover sits, in viewport coordinates.
 *
 * It is positioned `fixed` rather than `absolute` because the approvals table lives inside a
 * `Card` with `overflow-hidden` (the card clips the table to its own rounded corners). An
 * absolutely positioned popover is a descendant of that box and gets CLIPPED by it — which is
 * what made the popover on the last row, or on the only row, look like it opened "behind"
 * something. There is nothing below those rows for it to grow into. A fixed element's
 * containing block is the viewport, so no ancestor's overflow can crop it.
 *
 * That only holds while no ancestor creates a containing block for fixed descendants — a
 * `transform`, `filter`, `backdrop-blur`, `perspective`, `will-change` or `contain` anywhere
 * above this in the tree would silently re-clip it. None exists today; if the shell ever gains
 * a backdrop blur, this needs a portal instead.
 */
export function decidePlacement({
  button,
  popover,
  viewport,
  gap = 8,
  margin = 8,
}: {
  button: Rect;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Space between the button and the popover. */
  gap?: number;
  /** Smallest distance to keep from the viewport edges. */
  margin?: number;
}): Placement {
  const below = button.bottom + gap;
  const above = button.top - gap - popover.height;

  const fitsBelow = below + popover.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  // Prefer below — that is where a dropdown is expected. Flip up only when it genuinely does
  // not fit and flipping actually helps; when neither side fits (a popover taller than the
  // viewport), stay below and clamp, so it opens downward from the button rather than
  // jumping somewhere unrelated.
  const side: 'below' | 'above' = !fitsBelow && fitsAbove ? 'above' : 'below';

  const rawTop = side === 'above' ? above : below;
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  const top = Math.min(Math.max(rawTop, margin), maxTop);

  // Right-aligned to the button, matching the design's `right-0` anchoring, then kept on screen.
  const rawLeft = button.right - popover.width;
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const left = Math.min(Math.max(rawLeft, margin), maxLeft);

  return { top, left, side };
}
