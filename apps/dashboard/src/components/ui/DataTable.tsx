'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Table, THead, Tbody, Tr, Th, Td } from './Table';
import { EmptyState } from './EmptyState';
import { buttonClasses } from './Button';
import { startedOnInteractive } from '../../lib/row-click';
import {
  nextSort,
  sortRows,
  stickyOffsets,
  paginate,
  pageCount,
  clampPage,
  toggleKey,
  togglePage,
  type Sort,
} from '../../lib/data-table';

// Fixed width for the injected selection checkbox column, so it can join the frozen offsets
// the same way a declared `sticky` column does.
const SELECT_COLUMN_WIDTH = 40;

type ColumnBase<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /**
   * Presence makes the column sortable, and supplies the value to sort on. Encoding it this
   * way rather than as `sortable: boolean` makes "sortable with nothing to sort by"
   * unrepresentable. Return null for "no data" — those rows sort last either way.
   */
  sortBy?: (row: T) => string | number | null;
  align?: 'left' | 'right';
};

/**
 * `sticky: true` requires `width` — a discriminated union rather than two independent
 * optionals — because the frozen left offset is derived from it (`stickyOffsets`) and the
 * cell is rendered at that width so the offset stays correct while scrolling (see
 * `lib/data-table.ts`'s `stickyOffsets` doc comment). A sticky column with no width is not a
 * smaller bug, it is unrepresentable.
 */
export type Column<T> = ColumnBase<T> &
  ({ sticky: true; width: number } | { sticky?: false; width?: number });

/**
 * The data-dense table: sortable headers, optional frozen leading columns, optional row click.
 *
 * MUST be used from a `'use client'` file. `render`, `sortBy` and `onRowClick` are functions,
 * and a Server Component cannot pass a function to a Client Component — so each adopter is a
 * thin client wrapper that owns its column definitions while its page stays server-rendered
 * and passes only serializable rows.
 *
 * Sorting is client-side over the whole dataset. That is correct here because every adopter
 * receives its complete row set; it would be wrong for a server-paginated table, which is why
 * the cursor-paginated audit log keeps the compound `Table` instead.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  empty,
  onRowClick,
  pageSize,
  selectedKeys,
  onSelectionChange,
  hideable,
  renderExpanded,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: Sort;
  empty?: { title: string; body?: string; icon?: ReactNode };
  onRowClick?: (row: T) => void;
  /** Absent = no pagination, all rows render as before. */
  pageSize?: number;
  /** Supply both or neither — together they turn on the leading checkbox column. */
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Renders a "Columns" disclosure so the viewer can hide/show columns. At least one column
   *  stays visible always. */
  hideable?: boolean;
  /** Renders a chevron in the first cell that expands a full-width panel beneath the row.
   *  Rows stop being clickable when this is set — expanding and navigating is not one gesture. */
  renderExpanded?: (row: T) => ReactNode;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  // The native checkbox's indeterminate visual has no HTML attribute — it is a DOM-only
  // property, and `aria-checked="mixed"` is invalid on an <input type="checkbox"> (it is only
  // valid on role="checkbox"), so it goes through a ref instead of the render output.
  const selectAllRef = useRef<HTMLInputElement>(null);

  // A sort that leaves you on page 3 of a reordered list is disorienting, so re-sorting
  // always returns to page 1.
  useEffect(() => {
    setPage(1);
  }, [sort]);

  const hasSelection = selectedKeys !== undefined && onSelectionChange !== undefined;

  // Hiding all columns would leave nothing to show, so at least one always stays visible
  // (enforced in toggleColumnHidden below, not just here).
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden.includes(c.key)),
    [columns, hidden],
  );

  const toggleColumnHidden = (key: string) => {
    setHidden((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (columns.length - cur.length <= 1) return cur; // keep at least one visible
      return [...cur, key];
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  // Frozen columns are the leading run of `sticky` columns; a sticky column after a
  // non-sticky one cannot be frozen (there is nothing to pin it against). The `break` lets
  // TypeScript narrow each `c` to the `sticky: true` arm of the union past that point, so
  // `c.width` is `number` here with no fallback needed. The injected selection column, when
  // present, is always frozen first — it must stay pinned alongside whatever else is frozen.
  // Iterating `visibleColumns` (not `columns`) keeps the offsets correct when a frozen column
  // is hidden.
  const frozenWidths = useMemo(() => {
    const widths: number[] = hasSelection ? [SELECT_COLUMN_WIDTH] : [];
    for (const c of visibleColumns) {
      if (!c.sticky) break;
      widths.push(c.width);
    }
    return widths;
  }, [visibleColumns, hasSelection]);

  const frozenCount = frozenWidths.length;

  const offsets = useMemo(() => stickyOffsets(frozenWidths), [frozenWidths]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortBy) return rows;
    return sortRows(rows, col.sortBy, sort.dir);
  }, [rows, columns, sort]);

  const visible = pageSize ? paginate(sorted, page, pageSize) : sorted;
  const pages = pageSize ? pageCount(sorted.length, pageSize) : 1;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? 'No data'}
        {...(empty?.body ? { body: empty.body } : {})}
        {...(empty?.icon ? { icon: empty.icon } : {})}
      />
    );
  }

  // Merges the frozen-column positioning with the declared width, applied to both the header
  // and body cell of a column. Applying `width`/`maxWidth` (not just sticky `left`) is what
  // makes `stickyOffsets`' precondition — that a frozen column renders at the width its
  // offset was computed from — actually hold, rather than just being documented. `i` is the
  // rendered position, counting the injected selection column when present, so it lines up
  // with `frozenWidths`/`offsets` above.
  const cellStyle = (i: number, width: number | undefined): CSSProperties | undefined => {
    const sticky =
      i < frozenCount
        ? {
            position: 'sticky' as const,
            left: offsets[i],
            zIndex: 1,
            background: 'var(--tt-surface-raised)',
          }
        : undefined;
    const w = width !== undefined ? { width, maxWidth: width } : undefined;
    return sticky || w ? { ...sticky, ...w } : undefined;
  };

  // Selection is scoped to the currently visible page — selecting "all" only selects what is
  // on screen, and stale off-page selections are left untouched (see `togglePage`).
  const pageKeys = hasSelection ? visible.map(rowKey) : [];
  const selectedSet = new Set(selectedKeys ?? []);
  const selectedOnPage = pageKeys.filter((k) => selectedSet.has(k));
  const allOnPageSelected = pageKeys.length > 0 && selectedOnPage.length === pageKeys.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  // A sort/filter can shrink `pages` below an already-advanced `page`; the display value
  // clamps so the pager and its Prev/Next disabled states can't read "3 of 2".
  const displayPage = clampPage(page, pages);

  // Total rendered cells per row, for the expanded panel's colSpan.
  const columnCount = visibleColumns.length + (hasSelection ? 1 : 0);

  return (
    <>
      {hideable ? (
        <div className="flex justify-end px-[26px] py-2">
          <div className="relative inline-block">
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-label="Choose visible columns"
              onClick={() => setMenuOpen((o) => !o)}
              className={buttonClasses('secondary', 'sm')}
            >
              Columns <span aria-hidden="true">▾</span>
            </button>
            {menuOpen ? (
              <div
                role="group"
                aria-label="Visible columns"
                className="bg-surface-raised border-separator absolute right-0 z-10 mt-1 min-w-[160px] rounded-md border p-2 shadow-lg"
              >
                {columns.map((col) => (
                  <label key={col.key} className="text-caption flex items-center gap-2 px-2 py-1">
                    <input
                      type="checkbox"
                      checked={!hidden.includes(col.key)}
                      onChange={() => toggleColumnHidden(col.key)}
                    />
                    {col.header}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            {hasSelection ? (
              <Th style={cellStyle(0, SELECT_COLUMN_WIDTH)}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  onChange={() =>
                    onSelectionChange(togglePage(selectedKeys, pageKeys, !allOnPageSelected))
                  }
                />
              </Th>
            ) : null}
            {visibleColumns.map((col, i) => (
              <Th
                key={col.key}
                align={col.align ?? 'left'}
                {...(col.sortBy ? { sortable: true } : {})}
                sortDirection={sort?.key === col.key ? sort.dir : null}
                {...(col.sortBy
                  ? { onSortClick: () => setSort((cur) => nextSort(cur, col.key)) }
                  : {})}
                style={cellStyle(hasSelection ? i + 1 : i, col.width)}
              >
                {col.header}
              </Th>
            ))}
          </tr>
        </THead>
        <Tbody>
          {visible.map((row) => {
            const key = rowKey(row);
            const rowExpanded = expandedKeys.includes(key);
            return (
              <Fragment key={key}>
                <Tr
                  className="row-3d"
                  {...(onRowClick && !renderExpanded
                    ? {
                        interactive: true,
                        // A link or control inside the row handles its own click; firing the
                        // row's too would act twice (e.g. push the same URL on top of a link).
                        onClick: (e: MouseEvent<HTMLTableRowElement>) => {
                          if (!startedOnInteractive(e.target)) onRowClick(row);
                        },
                      }
                    : {})}
                >
                  {hasSelection ? (
                    <Td style={cellStyle(0, SELECT_COLUMN_WIDTH)}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selectedSet.has(key)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onSelectionChange(toggleKey(selectedKeys, key))}
                      />
                    </Td>
                  ) : null}
                  {visibleColumns.map((col, i) => (
                    <Td
                      key={col.key}
                      align={col.align ?? 'left'}
                      style={cellStyle(hasSelection ? i + 1 : i, col.width)}
                      {...(col.width !== undefined ? { className: 'truncate' } : {})}
                    >
                      {renderExpanded && i === 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            aria-expanded={rowExpanded}
                            aria-label={rowExpanded ? 'Collapse row' : 'Expand row'}
                            onClick={() => toggleExpanded(key)}
                            className="text-neutral hover:text-text"
                          >
                            <span aria-hidden="true">{rowExpanded ? '▾' : '▸'}</span>
                          </button>
                          {col.render(row)}
                        </span>
                      ) : (
                        col.render(row)
                      )}
                    </Td>
                  ))}
                </Tr>
                {renderExpanded && rowExpanded ? (
                  <Tr>
                    <Td colSpan={columnCount} className="bg-surface-raised">
                      {renderExpanded(row)}
                    </Td>
                  </Tr>
                ) : null}
              </Fragment>
            );
          })}
        </Tbody>
      </Table>
      {pageSize && pages > 1 ? (
        <div className="flex items-center justify-between px-[26px] py-3">
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            disabled={displayPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span className="text-text-secondary text-caption">
            {displayPage} of {pages}
          </span>
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            disabled={displayPage >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
