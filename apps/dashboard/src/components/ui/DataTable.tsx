'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Table, THead, Tbody, Tr, Th, Td } from './Table';
import { EmptyState } from './EmptyState';
import { nextSort, sortRows, stickyOffsets, type Sort } from '../../lib/data-table';

export type Column<T> = {
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
  /** Required when `sticky` is set: the frozen left offsets are derived from these. */
  width?: number;
  sticky?: boolean;
};

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
  // non-sticky one cannot be frozen (there is nothing to pin it against).
  const frozenCount = useMemo(() => {
    let n = 0;
    for (const c of columns) {
      if (!c.sticky) break;
      n++;
    }
    return n;
  }, [columns]);

  const offsets = useMemo(
    () => stickyOffsets(columns.slice(0, frozenCount).map((c) => c.width ?? 0)),
    [columns, frozenCount],
  );

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

  const stickyStyle = (i: number) =>
    i < frozenCount
      ? {
          position: 'sticky' as const,
          left: offsets[i],
          zIndex: 1,
          background: 'var(--tt-surface-raised)',
        }
      : undefined;

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
              className={stickyStyle(i) ? 'sticky' : ''}
              style={stickyStyle(i)}
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
                style={stickyStyle(i)}
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
