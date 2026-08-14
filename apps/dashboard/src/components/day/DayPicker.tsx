'use client';

import { usePathname, useRouter } from 'next/navigation';

/**
 * Jump straight to a date. The arrows step one day at a time, which is fine for "yesterday" and
 * useless for "three weeks ago" — and because the middle control is a fixed "Today" action, the
 * chrome read as a date filter permanently stuck on today.
 *
 * Navigates by pushing `?date=`, the same URL state the arrows use, so the server component
 * re-renders exactly as it does for a link click. `max` stops the picker offering a future day
 * the arrows already refuse.
 */
export function DayPicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <input
      type="date"
      value={date}
      max={today}
      aria-label="Jump to date"
      onChange={(e) => {
        const next = e.target.value;
        // Clearing the field fires an empty value; ignore it rather than navigating to today.
        if (next) router.push(`${pathname}?date=${next}`);
      }}
      className="bg-surface border-separator text-text focus:border-accent tt-numeric rounded-md border px-2 py-1 text-label outline-none transition-colors"
    />
  );
}
