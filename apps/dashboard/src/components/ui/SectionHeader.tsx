import type { ReactNode } from 'react';

/** Uppercase section label + hairline rule + optional right-aligned action. */
export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="tt-eyebrow text-neutral m-0">{label}</h2>
      <div className="bg-separator h-px flex-1" />
      {action}
    </div>
  );
}
