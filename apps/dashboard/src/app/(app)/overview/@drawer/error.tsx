'use client';

import { SegmentError } from '../../../../components/ui/SegmentError';
import { RouteDrawer } from '../../../../components/ui/RouteDrawer';

/**
 * A failure while rendering the drawer stays in the drawer: this boundary belongs to the
 * `@drawer` slot, so Overview (the `children` slot) keeps rendering behind it, and the error
 * shows inside a closable drawer rather than as a bare block under the page.
 */
export default function DrawerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteDrawer title="Something went wrong" size="wide">
      <SegmentError error={error} retry={retry} />
    </RouteDrawer>
  );
}
