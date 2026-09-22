import { describe, it, expect } from 'vitest';
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

  it('right-aligns the columns that ask for it', () => {
    expect(render()).toContain('text-right');
  });
});
