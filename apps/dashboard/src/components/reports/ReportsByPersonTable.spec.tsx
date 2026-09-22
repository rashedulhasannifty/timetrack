import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { ReportsByPersonTable } from './ReportsByPersonTable';

// renderToStaticMarkup runs with no AppRouterContext, and useRouter() throws unconditionally
// without one; nothing else in this component's import graph touches next/navigation.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

const row = (over: Partial<TeamSummaryRow>): TeamSummaryRow => ({
  userId: 'u1',
  name: 'Ada',
  trackedSeconds: 3600,
  activityPct: 50,
  ...over,
});

describe('ReportsByPersonTable', () => {
  it('sorts by tracked time descending by default', () => {
    const html = renderToStaticMarkup(
      <ReportsByPersonTable
        rows={[
          row({ userId: 'u1', name: 'Low', trackedSeconds: 60 }),
          row({ userId: 'u2', name: 'High', trackedSeconds: 7200 }),
        ]}
      />,
    );
    expect(html.indexOf('High')).toBeLessThan(html.indexOf('Low'));
  });

  it('advertises its three sortable columns', () => {
    const html = renderToStaticMarkup(<ReportsByPersonTable rows={[row({})]} />);
    expect(html.match(/aria-sort/g)).toHaveLength(3);
  });

  it('shows an empty state with no rows', () => {
    expect(renderToStaticMarkup(<ReportsByPersonTable rows={[]} />)).toContain(
      'No tracked time in this range',
    );
  });
});
