'use client';

import { useState, type ReactNode } from 'react';

const TABS = ['Timeline', 'Activity', 'Screenshots', 'Idle'] as const;
type Tab = (typeof TABS)[number];

export function MeTabs({ panels }: { panels: Record<Tab, ReactNode> }) {
  const [active, setActive] = useState<Tab>('Timeline');
  return (
    <div className="flex flex-col gap-4">
      <nav className="border-separator flex gap-1 border-b" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={
              active === tab
                ? 'border-accent text-text text-label border-b-2 px-3 py-2 font-medium'
                : 'text-text-secondary hover:text-text text-label px-3 py-2'
            }
          >
            {tab}
          </button>
        ))}
      </nav>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}
