'use client';

import { useState } from 'react';

/** Expand/collapse a single row's pretty-printed diff. The only client component on the page. */
export function DiffToggle({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  if (json === '—') return <span className="text-neutral-400">—</span>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs text-blue-600 hover:underline"
      >
        {open ? 'Hide' : 'View'}
      </button>
      {open ? (
        <pre className="mt-1 max-w-md overflow-x-auto rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
          {json}
        </pre>
      ) : null}
    </div>
  );
}
