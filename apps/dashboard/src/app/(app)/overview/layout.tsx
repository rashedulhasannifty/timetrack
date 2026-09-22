import type { ReactNode } from 'react';

/**
 * Overview owns the `@drawer` slot, not the (app) layout, and that placement is the point.
 *
 * Next matches an intercepting route by the `Next-Url` header (the URL the client router says
 * it is navigating FROM) against the path of the segment that holds the interception marker —
 * see generateInterceptionRoutesRewrites in next/dist/lib. A slot at (app) level yields the
 * pattern `/.*`, i.e. EVERY referrer, so a `?panel=` or `?date=` change on a hard-loaded
 * `/people/<id>` page would be intercepted and open a drawer over the full page. Holding the
 * slot here yields `/overview(?:/.*)?`: only a navigation that starts on Overview opens the
 * drawer, and a direct load of `/people/<id>` never mounts this layout at all.
 *
 * Overview's own page, loading.tsx and error.tsx live in the `(board)` route group: Next
 * applies a segment's loading/error files to EVERY slot of its layout, so beside this layout
 * they rendered a second PageSkeleton in the drawer slot on a soft nav into Overview.
 */
export default function OverviewLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
