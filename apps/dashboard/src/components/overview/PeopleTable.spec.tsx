import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PeopleTable } from './PeopleTable';
import type { PersonRow } from '../../lib/overview-view';

const row = (over: Partial<PersonRow>): PersonRow => ({
  userId: 'u1',
  name: 'Ada',
  live: false,
  trackedSeconds: 3600,
  activityPct: 47,
  productivePct: 60,
  unproductivePct: 20,
  idlePct: 10,
  idleMinutes: 6,
  ...over,
});

describe('PeopleTable', () => {
  it('renders a row per person', () => {
    const html = renderToStaticMarkup(
      <PeopleTable
        rows={[row({ userId: 'u1', name: 'Ada' }), row({ userId: 'u2', name: 'Bea' })]}
      />,
    );
    expect(html).toContain('Ada');
    expect(html).toContain('Bea');
  });

  it('sorts by tracked time descending by default', () => {
    const html = renderToStaticMarkup(
      <PeopleTable
        rows={[
          row({ userId: 'u1', name: 'Low', trackedSeconds: 60 }),
          row({ userId: 'u2', name: 'High', trackedSeconds: 7200 }),
        ]}
      />,
    );
    expect(html.indexOf('High')).toBeLessThan(html.indexOf('Low'));
  });

  /** A degraded team-activity response must never read as "0% productive". */
  it('renders an em dash for missing focus mix and idle', () => {
    const html = renderToStaticMarkup(
      <PeopleTable rows={[row({ productivePct: null, unproductivePct: null, idlePct: null })]} />,
    );
    expect(html).toContain('—');
    expect(html).not.toContain('0%');
  });

  it('shows the empty state when nobody tracked time', () => {
    const html = renderToStaticMarkup(<PeopleTable rows={[]} />);
    expect(html).toContain('No people tracked time in this range');
  });

  it('keeps the live indicator for someone tracking now', () => {
    const html = renderToStaticMarkup(<PeopleTable rows={[row({ live: true })]} />);
    expect(html).toContain('tracking now');
  });
});
