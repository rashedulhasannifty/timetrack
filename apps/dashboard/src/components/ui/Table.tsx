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

/** Row; `interactive` adds hover/cursor styling only (any click handler stays with the caller). */
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
    <tr className={`${hover} ${className}`.trim()} {...rest}>
      {children}
    </tr>
  );
}

const HEAD_ALIGN = { left: 'text-left', right: 'text-right' } as const;

/**
 * Header cell. Unifies the header styling that was copy-pasted across the tables. When `sortable`,
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
  const base =
    `text-text-secondary px-3 py-[9px] text-[11px] font-medium uppercase tracking-[0.08em] first:pl-[22px] last:pr-[22px] ${HEAD_ALIGN[align]} ${className}`.trim();
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
        className="inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {children} <span aria-hidden="true">{caret}</span>
      </button>
    </th>
  );
}

/**
 * Body cell. `align="right"` right-aligns and applies tabular numerals for numeric columns.
 * The row rule is a `border-t` here rather than a `border-b`: the first body row then draws the
 * line under the header, and the last row leaves the card's own edge clean.
 */
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
  const alignCls = align === 'right' ? 'text-right tt-numeric' : 'text-left';
  return (
    <td
      className={`border-separator border-t px-3 py-3 first:pl-[22px] last:pr-[22px] ${alignCls} ${className}`.trim()}
      {...rest}
    >
      {children}
    </td>
  );
}
