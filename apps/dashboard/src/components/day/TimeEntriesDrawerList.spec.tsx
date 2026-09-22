import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimeEntriesDrawerList } from './TimeEntriesDrawerList';
import type { DayEntryRow } from '../../lib/person-day-view';

const row = (over: Partial<DayEntryRow> = {}): DayEntryRow => ({
  id: 'e1',
  startMs: Date.parse('2026-07-13T03:00:00.000Z'),
  endMs: Date.parse('2026-07-13T04:00:00.000Z'),
  label: 'Energy Reporting',
  durationSeconds: 3600,
  running: false,
  startClock: '09:00',
  endClock: '10:00',
  projectId: 'p1',
  taskId: null,
  note: null,
  projectName: 'Energy Reporting',
  taskName: null,
  source: 'AUTO',
  activity: {
    activePct: null,
    mix: { productivePct: 0, neutralPct: 0, unproductivePct: 0, sampled: 0 },
    topApps: [],
  },
  ...over,
});

// Closed-state markup only: opening the drawer, the row-click guard and nesting inside the
// person drawer need a DOM and belong in the Playwright suite.
describe('TimeEntriesDrawerList (closed state)', () => {
  it('renders each entry label as a button that can open its detail', () => {
    const html = renderToStaticMarkup(
      <TimeEntriesDrawerList entries={[row(), row({ id: 'e2', label: 'Standup' })]} />,
    );
    expect(html).toMatch(/<button type="button"[^>]*>Energy Reporting<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Standup<\/button>/);
    expect(html).toContain('09:00–10:00');
    expect(html).toContain('1h 0m');
  });

  it('shows "running" for a running entry', () => {
    const html = renderToStaticMarkup(
      <TimeEntriesDrawerList entries={[row({ running: true, endMs: null })]} />,
    );
    expect(html).toContain('running');
  });

  it('places each pre-rendered row action in its own row', () => {
    const html = renderToStaticMarkup(
      <TimeEntriesDrawerList
        entries={[row(), row({ id: 'e2', label: 'Standup' })]}
        actions={{ e1: <span>act-e1</span>, e2: <span>act-e2</span> }}
      />,
    );
    const rows = html.split('<li').slice(1);
    expect(rows[0]).toContain('act-e1');
    expect(rows[0]).not.toContain('act-e2');
    expect(rows[1]).toContain('act-e2');
  });

  it('does not render the drawer while nothing is open', () => {
    const html = renderToStaticMarkup(<TimeEntriesDrawerList entries={[row()]} />);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('During this entry');
  });

  it('renders the empty state', () => {
    expect(renderToStaticMarkup(<TimeEntriesDrawerList entries={[]} />)).toContain(
      'No entries in range.',
    );
  });
});
