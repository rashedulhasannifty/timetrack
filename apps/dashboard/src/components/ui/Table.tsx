import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from 'react';

/** Full-width table shell; place inside a `<Card padding="none">`. */
export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <table className={`w-full border-collapse text-[13px] ${className}`.trim()}>{children}</table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/**
 * Row. The rule sits on the row's TOP edge rather than each cell's bottom, so the last row
 * meets the card's rounded corner cleanly instead of drawing a line across it.
 * `interactive` adds hover/cursor styling only (any click handler stays with the caller).
 */
export function Tr({
  children,
  interactive = false,
  className = '',
  ...rest
}: {
  children: ReactNode;
  interactive?: boolean;
  className?: string;
} & HTMLAttributes<HTMLTableRowElement>) {
  const hover = interactive ? 'hover:bg-surface cursor-pointer' : '';
  return (
    <tr className={`border-separator border-t ${hover} ${className}`.trim()} {...rest}>
      {children}
    </tr>
  );
}

const HEAD_ALIGN = { left: 'text-left', right: 'text-right' } as const;

/**
 * Header cell — the `tt-eyebrow` voice (10.5px, heavy, uppercase, wide). When `sortable`,
 * wraps children in a button and shows a caret from `sortDirection` (↑ asc / ↓ desc / ⇅ inactive);
 * the sort state + handler stay with the caller (used only by the client Reports table).
 */
export function Th({
  children,
  align = 'left',
  sortable = false,
  sortDirection = null,
  onSortClick,
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSortClick?: () => void;
  className?: string;
}) {
  const base = `tt-eyebrow text-neutral px-[26px] py-3 ${HEAD_ALIGN[align]} ${className}`.trim();
  if (!sortable) {
    return (
      <th scope="col" className={base}>
        {children}
      </th>
    );
  }
  const caret = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '⇅';
  return (
    <th
      scope="col"
      className={base}
      aria-sort={
        sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'
      }
    >
      <button
        type="button"
        onClick={onSortClick}
        className="focus-visible:outline-accent inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        {children} <span aria-hidden="true">{caret}</span>
      </button>
    </th>
  );
}

/** Body cell. `align="right"` right-aligns and applies tabular numerals for numeric columns. */
export function Td({
  children,
  align = 'left',
  className = '',
  ...rest
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  const alignCls = align === 'right' ? 'tt-numeric text-right' : 'text-left';
  return (
    <td className={`px-[26px] py-[13px] ${alignCls} ${className}`.trim()} {...rest}>
      {children}
    </td>
  );
}
