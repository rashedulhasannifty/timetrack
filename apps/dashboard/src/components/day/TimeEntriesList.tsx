import type { ReactNode } from 'react';
import type { DayEntryRow } from '../../lib/person-day-view';
import { TimeEntriesDrawerList } from './TimeEntriesDrawerList';

/**
 * Server adapter for the day's entry list. The list itself (and the entry detail drawer) is the
 * client `TimeEntriesDrawerList`; this stays a Server Component so `DayPanels` can keep handing
 * it a per-row render function, which cannot cross the RSC boundary. It pre-renders that slot
 * for each entry into a record keyed by entry id, which can.
 */
export function TimeEntriesList({
  entries,
  rowAction,
}: {
  entries: DayEntryRow[];
  /**
   * Per-row edit/delete, supplied by the surface that is allowed to offer it — the same slot
   * pattern `DayPanels` uses for redaction and idle resolution, rather than an `isSelf` branch
   * threaded through the markup.
   */
  // `| undefined` explicitly: exactOptionalPropertyTypes rejects forwarding a possibly-
  // undefined prop into a bare optional one (TS2375).
  rowAction?: ((entry: DayEntryRow) => ReactNode) | undefined;
}) {
  const actions = rowAction
    ? Object.fromEntries(entries.map((e) => [e.id, rowAction(e)]))
    : undefined;
  return <TimeEntriesDrawerList entries={entries} actions={actions} />;
}
