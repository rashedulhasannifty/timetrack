import type { SVGProps } from 'react';

/**
 * The product mark — the same elapsed-time ring as the macOS app icon and the favicon,
 * redrawn for small on-screen use rather than scaled down from the 1024px artwork.
 *
 * Colours come from the shared tokens, not hex: the elapsed arc is `recording` and the
 * remainder is `category-productive`, which are the same two tokens the macOS client uses
 * for the same two roles. That also makes it theme-aware for free — both tokens shift under
 * `.dark`. The crown tick is `currentColor` so it sits with whatever text it is set beside.
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
        className="stroke-category-productive"
        strokeOpacity="0.45"
        strokeWidth="3.2"
      />
      {/* elapsed — ~70%, clockwise from 12 o'clock */}
      <path
        d="M 12,5.2 A 7.3,7.3 0 1,1 5.06,14.76"
        className="stroke-recording"
        strokeWidth="3.2"
      />
      {/* crown tick, overlapping the ring so the two never separate when scaled */}
      <rect x="11.1" y="1.7" width="1.8" height="3.4" rx="0.9" fill="currentColor" />
    </svg>
  );
}
