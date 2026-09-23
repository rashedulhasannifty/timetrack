import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Platform, TeamOverviewRow } from '@timetrack/contracts';

const { teamOverview } = vi.hoisted(() => ({ teamOverview: vi.fn() }));
// ApiError is a real class here, not a stub: the component branches on `instanceof`, so a fake
// would make every failure look like a fault and the 403 test would pass for the wrong reason.
vi.mock('../../lib/api-client', async (orig) => ({
  ...(await orig<typeof import('../../lib/api-client')>()),
  api: { teamOverview },
}));

const { ApiError } = await import('../../lib/api-client');

import { TrackingFooter } from './TrackingFooter';

const row = (
  name: string,
  tracking: boolean,
  platform: Platform | null = null,
): TeamOverviewRow => ({
  userId: `u-${name}`,
  name,
  tracking,
  platform,
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

  it('shows the platform breakdown under the names', async () => {
    const html = await render([
      row('Ada', true, 'MACOS'),
      row('Bea', true, 'WINDOWS'),
      row('Cy', true, null),
    ]);
    expect(html).toContain('3 tracking now');
    expect(html).toContain('1 on Mac · 1 on Windows · 1 unknown');
  });

  /**
   * Regression guard for the whole design: while no client reports a platform the card must look
   * exactly as it did before the field existed — no empty line, and above all no "0 on Windows"
   * beside someone who is visibly tracking.
   */
  it('shows no breakdown, and never a zero, while every client is silent', async () => {
    const html = await render([row('Ada', true), row('Bea', true)]);
    expect(html).toContain('2 tracking now');
    expect(html).not.toContain('on Mac');
    expect(html).not.toContain('on Windows');
    expect(html).not.toContain('unknown');
  });

  /**
   * An EMPLOYEE has no team-wide visibility, and a 401 is a token the layout is already
   * refreshing. Both are expected, so the card is absent rather than broken-looking.
   */
  it.each([403, 401])('renders nothing on a %i', async (status) => {
    teamOverview.mockImplementation(() => Promise.reject(new ApiError(status, 'nope')));
    expect(renderToStaticMarkup(await TrackingFooter({ token: 't' }))).toBe('');
  });

  /**
   * Regression for the bug that cost an afternoon: a response failing TeamOverviewSchema — an
   * API older than the dashboard, i.e. a half-deployed `platform` — used to be swallowed by a
   * bare `catch { return null }`, so the card just vanished. Silence is the thing being fixed;
   * the card must now say something.
   */
  it.each([
    ['a schema mismatch', new Error('Invalid option: expected one of "MACOS"|"WINDOWS"')],
    ['a 500', new ApiError(500, 'Internal Server Error')],
    ['an unreachable API', new TypeError('fetch failed')],
  ])('reports %s instead of vanishing', async (_label, err) => {
    teamOverview.mockImplementation(() => Promise.reject(err));
    const html = renderToStaticMarkup(await TrackingFooter({ token: 't' }));

    expect(html).not.toBe('');
    expect(html).toContain('Live status unavailable');
    // Never a bare "0 tracking now" on a failure — that is a claim, not an absence of data.
    expect(html).not.toContain('tracking now');
  });
});
