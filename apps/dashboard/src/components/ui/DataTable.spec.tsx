import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataTable, type Column } from './DataTable';

type Row = { id: string; name: string; n: number };

const rows: Row[] = [
  { id: 'a', name: 'Bea', n: 2 },
  { id: 'b', name: 'Ada', n: 3 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Person', render: (r) => r.name, sortBy: (r) => r.name },
  { key: 'n', header: 'Count', render: (r) => r.n, sortBy: (r) => r.n, align: 'right' },
  { key: 'note', header: 'Note', render: () => '—' },
];

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <DataTable columns={columns} rows={rows} rowKey={(r: Row) => r.id} {...props} />,
  );

describe('DataTable', () => {
  it('renders every column header', () => {
    const html = render();
    expect(html).toContain('Person');
    expect(html).toContain('Count');
    expect(html).toContain('Note');
  });

  it('renders a cell per row via the column renderer', () => {
    const html = render();
    expect(html).toContain('Bea');
    expect(html).toContain('Ada');
  });

  /** A column with no sortBy accessor must not advertise sortability — aria-sort on an
   *  unsortable header tells assistive tech about an interaction that does not exist. */
  it('marks only accessor-bearing columns as sortable', () => {
    const html = render();
    expect(html.match(/aria-sort/g)).toHaveLength(2);
  });

  it('applies the initial sort before first paint', () => {
    const html = render({ initialSort: { key: 'name', dir: 'asc' } });
    expect(html.indexOf('Ada')).toBeLessThan(html.indexOf('Bea'));
    expect(html).toContain('aria-sort="ascending"');
  });

  it('renders rows unsorted when no initial sort is given', () => {
    const html = render();
    expect(html.indexOf('Bea')).toBeLessThan(html.indexOf('Ada'));
  });

  it('shows the empty state instead of an empty table body', () => {
    const html = render({ rows: [], empty: { title: 'No people' } });
    expect(html).toContain('No people');
    expect(html).not.toContain('<tbody');
  });

  it('falls back to a default empty state', () => {
    expect(render({ rows: [] })).toContain('No data');
  });

  /**
   * Frozen columns need a numeric width to derive their left offset from. A sticky column
   * without one would silently get left:0 and stack on top of its neighbour.
   */
  it('gives frozen columns a left offset from their declared widths', () => {
    const frozen: Column<Row>[] = [
      { key: 'name', header: 'Person', render: (r) => r.name, sticky: true, width: 120 },
      { key: 'n', header: 'Count', render: (r) => r.n, sticky: true, width: 80 },
      { key: 'note', header: 'Note', render: () => '—' },
    ];
    const html = renderToStaticMarkup(
      <DataTable columns={frozen} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(html).toContain('left:0');
    expect(html).toContain('left:120px');
  });

  /**
   * The offset math is only correct if the column actually renders at the width it was
   * computed from — otherwise a frozen column wider than its declared width overlaps its
   * neighbour while scrolling. `width`/`max-width` must land on the rendered cell, not just
   * feed `stickyOffsets`.
   */
  it('renders a frozen column at its declared width', () => {
    const frozen: Column<Row>[] = [
      { key: 'name', header: 'Person', render: (r) => r.name, sticky: true, width: 120 },
      { key: 'n', header: 'Count', render: (r) => r.n, sticky: true, width: 80 },
      { key: 'note', header: 'Note', render: () => '—' },
    ];
    const html = renderToStaticMarkup(
      <DataTable columns={frozen} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(html).toContain('max-width:120px');
    expect(html).toContain('max-width:80px');
  });

  it('right-aligns the columns that ask for it', () => {
    expect(render()).toContain('text-right');
  });
});

describe('DataTable pagination', () => {
  const many: Row[] = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    name: `P${i}`,
    n: i,
  }));

  it('renders only the first page when a page size is set', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={2} />,
    );
    expect(html).toContain('P0');
    expect(html).toContain('P1');
    expect(html).not.toContain('P2');
  });

  it('reports the page count', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={2} />,
    );
    expect(html).toContain('1 of 3');
  });

  it('renders no pager when every row fits on one page', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={50} />,
    );
    expect(html).not.toContain(' of ');
  });
});

describe('DataTable row selection', () => {
  it('renders no checkbox column by default', () => {
    expect(render()).not.toContain('type="checkbox"');
  });

  it('renders no checkbox column when only one of the two props is given', () => {
    expect(render({ selectedKeys: [] })).not.toContain('type="checkbox"');
  });

  it('renders a checkbox column when both selection props are given', () => {
    const html = render({ selectedKeys: [], onSelectionChange: () => {} });
    // One header checkbox plus one per row.
    expect(html.match(/type="checkbox"/g)).toHaveLength(rows.length + 1);
  });

  /** `aria-checked="mixed"` is invalid on a native `<input type="checkbox">` (it is only valid
   *  on `role="checkbox"`); the partial-selection visual is set as the DOM `indeterminate`
   *  property instead, which is not observable in static markup. */
  it('never emits aria-checked="mixed" on the native select-all checkbox', () => {
    const html = render({
      selectedKeys: ['a'],
      onSelectionChange: () => {},
    });
    expect(html).not.toContain('aria-checked');
  });
});

describe('DataTable column visibility', () => {
  it('renders no columns menu by default', () => {
    expect(render()).not.toContain('Columns');
  });

  it('renders a columns menu when hideable', () => {
    expect(render({ hideable: true })).toContain('Columns');
  });

  /**
   * The columns disclosure panel only renders once `menuOpen` is toggled true, and this suite
   * has no DOM to click the "Columns" button with — so its role/label are pinned by reading
   * the source, the same way TabPills.spec.tsx pins a CSS selector it cannot reach by
   * rendering. Plain checkboxes with no menu keyboard model, so it is a labelled group, not a
   * menu (role="menu" expects arrow-key navigation between menuitems, which this panel does
   * not implement).
   */
  it('exposes the columns panel as a labelled group, not a menu', () => {
    const src = readFileSync(join(__dirname, './DataTable.tsx'), 'utf8');
    expect(src).toContain('role="group"');
    expect(src).toContain('aria-label="Visible columns"');
    expect(src).not.toContain('role="menu"');
  });
});

describe('DataTable expandable rows', () => {
  it('renders no expander by default', () => {
    expect(render()).not.toContain('aria-expanded');
  });

  it('renders an expander per row when given a panel renderer', () => {
    const html = render({ renderExpanded: (r: Row) => <div>detail {r.name}</div> });
    expect(html.match(/aria-expanded/g)).toHaveLength(2);
  });

  /**
   * A row that both expands and navigates has no unambiguous click, so expansion wins and
   * onRowClick is ignored. Row-level actions belong inside the expanded panel.
   */
  it('ignores onRowClick when rows expand', () => {
    const html = render({
      renderExpanded: () => <div>d</div>,
      onRowClick: () => {},
    });
    expect(html).not.toContain('cursor-pointer');
  });
});
