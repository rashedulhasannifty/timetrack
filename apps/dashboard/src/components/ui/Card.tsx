import type { ReactNode } from 'react';

/**
 * The raised surface of the design system: rounded-lg (20px), hairline separator border,
 * elevation-1 shadow, surface-raised background. `padding='md'` applies the standard panel
 * padding; `padding='none'` (default) preserves the existing behavior where callers pass their
 * own — which is what tables and any card with a full-bleed header row need.
 */
export function Card({
  children,
  className = '',
  padding = 'none',
}: {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'md';
}) {
  const pad = padding === 'md' ? 'px-[26px] py-[22px]' : '';
  return (
    <div
      className={`bg-surface-raised border-separator shadow-e1 rounded-lg border ${pad} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A card's own header strip: title, optional muted note, optional right-aligned action. Sits
 * flush against a full-bleed body (a table, a row list) with a hairline under it.
 */
export function CardHeader({
  title,
  note,
  action,
  bordered = true,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-[26px] py-[18px] ${
        bordered ? 'border-separator border-b' : ''
      }`}
    >
      <span className="text-h3 font-bold">{title}</span>
      {note ? <span className="text-text-secondary text-caption">{note}</span> : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/** The in-card title used by padded cards (no bleed, no rule). */
export function CardTitle({
  children,
  action,
  note,
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-2.5 ${className}`.trim()}>
      <span className="text-h3 font-bold">{children}</span>
      {note ? <span className="text-text-secondary text-caption">{note}</span> : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}
