import type { SVGProps } from 'react';

/**
 * The product mark — the same elapsed-time ring as the macOS app icon and the favicon,
 * redrawn for small on-screen use rather than scaled down from the 1024px artwork.
 *
 * The two arcs read from `mark-remaining` / `mark-elapsed`, which are the only colour
 * tokens deliberately held identical in light and dark: the same two values are baked
 * into `icon.svg` and `apple-icon.png`, and a file cannot follow a theme. Letting these
 * shift would make the sidebar mark and the browser-tab favicon drift apart. The crown
 * tick is `currentColor` so it sits with whatever text it is set beside.
 *
 * The arcs meet flush with butt caps. The gapped, round-capped treatment used in the app
 * icon reads as noise below about 32px.
 */
export function BrandMark({ size = 18, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* remaining */}
      <path
        d="M 5.06,14.76 A 7.3,7.3 0 0,1 12,5.2"
        className="stroke-mark-remaining"
        strokeWidth="3.4"
      />
      {/* elapsed — ~70%, clockwise from 12 o'clock */}
      <path
        d="M 12,5.2 A 7.3,7.3 0 1,1 5.06,14.76"
        className="stroke-mark-elapsed"
        strokeWidth="3.4"
      />
      {/* crown tick, overlapping the ring so the two never separate when scaled */}
      <rect x="11.1" y="1.7" width="1.8" height="3.4" rx="0.9" fill="currentColor" />
    </svg>
  );
}

/**
 * The mark on its dark-teal chip, as the sidebar and marketing header wear it. The chip is
 * a fixed `hero` ground in both themes, so the tick inside it is always the light hero text
 * colour rather than inheriting from the surrounding surface.
 */
export function BrandChip({ size = 28 }: { size?: number }) {
  return (
    <span
      className="bg-hero text-hero-text inline-flex flex-none items-center justify-center rounded-[9px]"
      style={{ width: size, height: size }}
    >
      <BrandMark size={Math.round(size * 0.57)} />
    </span>
  );
}
