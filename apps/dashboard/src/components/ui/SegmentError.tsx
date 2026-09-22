'use client';

import { buttonClasses } from './Button';

/**
 * Segment error boundary. Next requires this to be a Client Component.
 *
 * `src/lib/api-client.ts` throws `ApiError extends Error` carrying the problem+json `title` as
 * its `message` (e.g. "Cannot deactivate the last active admin"). That is only what reaches this
 * boundary in **dev**, though: in a production build, Next replaces the `message` of any error
 * thrown in a Server Component with a generic sentence and attaches `error.digest` (an id to
 * match server-side logs), specifically so a message that turned out to carry something
 * sensitive can't leak to the client. So: when `digest` is present we show fixed copy; only when
 * it's absent — an error thrown on the client, which Next does not scrub — do we fall back to
 * `error.message`. We never render `error.stack` or `error.digest`.
 */
export function SegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const message = error.digest
    ? 'The page could not be loaded.'
    : error.message || 'The page could not be loaded.';

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="text-h2 font-bold">Something went wrong</span>
      <p className="text-text-secondary text-label max-w-[46ch]">{message}</p>
      <button type="button" onClick={retry} className={`${buttonClasses('primary', 'md')} mt-2`}>
        Try again
      </button>
    </div>
  );
}
