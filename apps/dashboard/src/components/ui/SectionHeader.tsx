import type { ReactNode } from 'react';

/** Panel heading: 15px semibold title, optional muted note beside it, optional right-aligned action. */
export function SectionHeader({
  label,
  note,
  action,
}: {
  label: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <h2 className="text-text text-body m-0 font-semibold">{label}</h2>
      {note ? <span className="text-caption text-text-secondary">{note}</span> : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}
