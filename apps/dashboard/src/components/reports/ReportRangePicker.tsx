'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/** Writes the selected range to the URL so the Server Component refetches. Date-only inputs
 *  are widened to full-day UTC bounds to match the API's datetime range. */
export function ReportRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: 'from' | 'to', dateOnly: string) {
    const iso = key === 'from' ? `${dateOnly}T00:00:00.000Z` : `${dateOnly}T23:59:59.999Z`;
    const next = new URLSearchParams(params.toString());
    next.set(key, iso);
    router.push(`/reports?${next.toString()}`);
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
