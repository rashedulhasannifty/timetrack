'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Table, THead, Tbody, Tr, Th, Td } from './Table';
import { EmptyState } from './EmptyState';
import { nextSort, sortRows, stickyOffsets, type Sort } from '../../lib/data-table';

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
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: Sort;
  empty?: { title: string; body?: string; icon?: ReactNode };
  onRowClick?: (row: T) => void;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null);

  // Frozen columns are the leading run of `sticky` columns; a sticky column after a
  // non-sticky one cannot be frozen (there is nothing to pin it against). The `break` lets
  // TypeScript narrow each `c` to the `sticky: true` arm of the union past that point, so
  // `c.width` is `number` here with no fallback needed.
  const frozenWidths = useMemo(() => {
    const widths: number[] = [];
    for (const c of columns) {
      if (!c.sticky) break;
      widths.push(c.width);
    }
    return widths;
  }, [columns]);

  const frozenCount = frozenWidths.length;

  const offsets = useMemo(() => stickyOffsets(frozenWidths), [frozenWidths]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortBy) return rows;
    return sortRows(rows, col.sortBy, sort.dir);
  }, [rows, columns, sort]);

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
  // offset was computed from — actually hold, rather than just being documented.
  const cellStyle = (col: Column<T>, i: number): CSSProperties | undefined => {
    const sticky =
      i < frozenCount
        ? {
            position: 'sticky' as const,
            left: offsets[i],
            zIndex: 1,
            background: 'var(--tt-surface-raised)',
          }
        : undefined;
    const width = col.width !== undefined ? { width: col.width, maxWidth: col.width } : undefined;
    return sticky || width ? { ...sticky, ...width } : undefined;
  };

  return (
    <Table>
      <THead>
        <tr>
          {columns.map((col, i) => (
            <Th
              key={col.key}
              align={col.align ?? 'left'}
              {...(col.sortBy ? { sortable: true } : {})}
              sortDirection={sort?.key === col.key ? sort.dir : null}
              {...(col.sortBy
                ? { onSortClick: () => setSort((cur) => nextSort(cur, col.key)) }
                : {})}
              style={cellStyle(col, i)}
            >
              {col.header}
            </Th>
          ))}
        </tr>
      </THead>
      <Tbody>
        {sorted.map((row) => (
          <Tr
            key={rowKey(row)}
            className="row-3d"
            {...(onRowClick ? { interactive: true, onClick: () => onRowClick(row) } : {})}
          >
            {columns.map((col, i) => (
              <Td
                key={col.key}
                align={col.align ?? 'left'}
                style={cellStyle(col, i)}
                {...(col.width !== undefined ? { className: 'truncate' } : {})}
              >
                {col.render(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
