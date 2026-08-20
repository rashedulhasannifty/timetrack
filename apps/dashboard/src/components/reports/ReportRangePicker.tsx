'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { reportRangeBound } from '../../lib/reports-view';

/** Writes the selected range to the URL so the Server Component refetches. Date-only inputs
 *  are widened to Dhaka-day instant bounds via `reportRangeBound` — the same convention
 *  `defaultReportRange` uses — to match the API's datetime range. An empty or otherwise
 *  invalid date (e.g. the field cleared mid-edit) is ignored rather than acted on: the
 *  underlying `dayStartInstant`/`shiftDay` helpers throw on a malformed label, and this runs
 *  in a client `onChange` handler where that would surface as an uncaught exception. */
export function ReportRangePicker({
  from,
  to,
  basePath = '/reports',
}: {
  from: string;
  to: string;
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: 'from' | 'to', dateOnly: string) {
    const iso = reportRangeBound(dateOnly, key);
    if (iso === null) return;
    const next = new URLSearchParams(params.toString());
    next.set(key, iso);
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <div className="flex items-end gap-3">
      <label className="text-text-secondary text-caption flex flex-col">
        From
        <input
          type="date"
          defaultValue={from.slice(0, 10)}
          onChange={(e) => update('from', e.target.value)}
          className="bg-surface-raised border-separator text-text focus:border-accent mt-1 rounded-md border px-2 py-1 text-label outline-none transition-colors"
        />
      </label>
      <label className="text-text-secondary text-caption flex flex-col">
        To
        <input
          type="date"
          defaultValue={to.slice(0, 10)}
          onChange={(e) => update('to', e.target.value)}
          className="bg-surface-raised border-separator text-text focus:border-accent mt-1 rounded-md border px-2 py-1 text-label outline-none transition-colors"
        />
      </label>
    </div>
  );
}
