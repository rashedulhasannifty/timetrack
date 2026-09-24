import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalsTable } from './ApprovalsTable';
import { ToastProvider } from '../../../components/ui/Toast';
import type { TimesheetApproval } from '@timetrack/contracts';

const row = (over: Partial<TimesheetApproval> = {}): TimesheetApproval => ({
  id: 'a1',
  userId: 'u1',
  userName: 'Ada Lovelace',
  periodStart: '2026-06-28T18:00:00.000Z',
  periodEnd: '2026-07-05T18:00:00.000Z',
  status: 'PENDING',
  trackedSeconds: 3600,
  totalSeconds: null,
  longEntrySeconds: null,
  reviewerId: null,
  note: null,
  decidedAt: null,
  ...over,
});

// Closed-state markup only — Drawer's open state, the row-click guard, and the drawer's own
// decide form are interaction-driven and belong in the Playwright suite (Task 6). This spec
// covers what the server-rendered closed table looks like, since vitest here is node-env with
// no DOM to click through.
describe('ApprovalsTable (closed state)', () => {
  it('renders a row per approval, with the name as a button', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable
          rows={[
            row({ id: 'a1', userName: 'Ada Lovelace' }),
            row({ id: 'a2', userName: 'Bea Byron' }),
          ]}
        />
      </ToastProvider>,
    );
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Bea Byron');
    expect(html).toMatch(/<button[^>]*>Ada Lovelace<\/button>/);
    expect(html).toMatch(/<button[^>]*>Bea Byron<\/button>/);
  });

  it('renders the status badge and hours for each row', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable rows={[row({ status: 'APPROVED', totalSeconds: 3600 })]} />
      </ToastProvider>,
    );
    expect(html).toContain('Approved');
    expect(html).toContain('1.0h');
  });

  it('flags an automatically-decided row', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable
          rows={[row({ status: 'APPROVED', reviewerId: null, totalSeconds: 3600 })]}
        />
      </ToastProvider>,
    );
    expect(html).toContain('automatically');
  });

  it("renders each row's own Decide control", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable rows={[row({ id: 'a1' }), row({ id: 'a2' })]} />
      </ToastProvider>,
    );
    expect(html.match(/Decide/g)?.length).toBe(2);
  });

  it('does not render the drawer while nothing is open', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable rows={[row()]} />
      </ToastProvider>,
    );
    // Drawer returns null while closed; its dialog role never appears in closed-state markup.
    expect(html).not.toContain('role="dialog"');
  });

  it('renders an empty table body for an empty row list without throwing', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ApprovalsTable rows={[]} />
      </ToastProvider>,
    );
    expect(html).toContain('<table');
  });
});
