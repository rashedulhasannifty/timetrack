'use client';

import { SegmentError } from '../ui/SegmentError';
import { RouteDrawer } from '../ui/RouteDrawer';

/**
 * A failure while rendering the person drawer stays in the drawer: the `@drawer` slot's
 * error.tsx uses this, so the underlying page (the `children` slot) keeps rendering behind it,
 * and the error shows inside a closable drawer rather than as a bare block under the page.
 */
export function PersonDrawerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteDrawer title="Couldn’t load this person" size="wide">
      <SegmentError error={error} retry={retry} />
    </RouteDrawer>
  );
}
