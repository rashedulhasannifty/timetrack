import type { ReactNode } from 'react';

/**
 * Reports owns a `@drawer` slot so a click on a "By person" row opens that person's day over the
 * report instead of navigating away. Same machinery as Overview — read overview/layout.tsx for
 * why the slot sits on this layout and not on (app): the interception pattern becomes
 * `/reports(?:/.*)?`, so only a navigation that starts on Reports opens the drawer.
 *
 * The page, loading.tsx and error.tsx live in the `(board)` route group so the segment's
 * loading/error files don't also render in the drawer slot. `export/` is a route handler and
 * stays outside the group; its URL is unchanged either way.
 */
export default function ReportsLayout({
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
