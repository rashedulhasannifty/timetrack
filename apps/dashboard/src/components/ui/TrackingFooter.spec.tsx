import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TeamOverviewRow } from '@timetrack/contracts';

const { teamOverview } = vi.hoisted(() => ({ teamOverview: vi.fn() }));
vi.mock('../../lib/api-client', () => ({ api: { teamOverview } }));

import { TrackingFooter } from './TrackingFooter';

const row = (name: string, tracking: boolean): TeamOverviewRow => ({
  userId: `u-${name}`,
  name,
  tracking,
  trackedSecondsToday: 3600,
});

/** The component is an async server component, so await it before handing it to the renderer. */
async function render(rows: TeamOverviewRow[]): Promise<string> {
  teamOverview.mockResolvedValue({ date: '2026-09-23', rows });
  return renderToStaticMarkup(await TrackingFooter({ token: 't' }));
}

describe('TrackingFooter', () => {
  // Block body, not a concise arrow: `mockReset()` returns the mock, and Vitest treats a hook's
  // return value as a teardown callback — it would call the mock after each test, turning the
  // rejecting case below into an unhandled rejection that fails an otherwise passing test.
  beforeEach(() => {
    teamOverview.mockReset();
  });

  it('counts only the people actually tracking', async () => {
    const html = await render([row('Ada', true), row('Bea', false), row('Cy', true)]);
    expect(html).toContain('2 tracking now');
    expect(html).toContain('Ada, Cy');
    expect(html).not.toContain('Bea');
  });

  /**
   * Regression: the empty state used to read "Nobody has the Mac app running", which implied the
   * count excluded Windows. It never did — `tracking` is an OS-blind EXISTS on an open,
   * heartbeating time_entries row, and the Windows client heartbeats open entries too.
   */
  it('names no platform in the empty state', async () => {
    const html = await render([row('Ada', false)]);
    expect(html).toContain('Nobody is tracking right now');
    expect(html).not.toMatch(/\bMac\b|macOS|Windows/);
  });

  /** Regression: "+N more" was dead text, so the names past the third were unreachable. */
  it('links the overflow to the people table', async () => {
    const names = ['Ada', 'Bea', 'Cy', 'Dot', 'Eve'];
    const html = await render(names.map((n) => row(n, true)));

    expect(html).toContain('5 tracking now');
    expect(html).toContain('Ada, Bea, Cy');
    expect(html).toContain('+2 more');
    expect(html).toContain('href="/overview"');
    // The link text alone ("+2 more") does not say where it goes or how many.
    expect(html).toContain('See all 5 people tracking now');
  });

  it('leaves no overflow link when every name fits', async () => {
    const html = await render([row('Ada', true), row('Bea', true), row('Cy', true)]);
    expect(html).toContain('Ada, Bea, Cy');
    expect(html).not.toContain('more');
    expect(html).not.toContain('href=');
  });

  /** Employees get a 403 from team-overview; the shell must render without a footer, not crash. */
  it('renders nothing when the call fails', async () => {
    teamOverview.mockImplementation(() => Promise.reject(new Error('403')));
    expect(renderToStaticMarkup(await TrackingFooter({ token: 't' }))).toBe('');
  });
});
