'use client';

import { useState } from 'react';

/** Expand/collapse a single row's pretty-printed diff. The only client component on the page. */
export function DiffToggle({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  if (json === '—') return <span className="text-text-secondary">—</span>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-accent text-caption hover:underline"
      >
        {open ? 'Hide' : 'View'}
      </button>
      {open ? (
        <pre className="bg-surface text-text mt-1 max-w-md overflow-x-auto rounded-md p-2 text-caption">
          {json}
        </pre>
      ) : null}
    </div>
  );
}
