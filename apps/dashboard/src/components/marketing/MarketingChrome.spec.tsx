import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session } from '../../lib/session';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn<() => Promise<Session | null>>() }));
vi.mock('../../lib/session', () => ({ getSession }));

import { MarketingChrome } from './MarketingChrome';

async function render(): Promise<string> {
  return renderToStaticMarkup(await MarketingChrome({ children: null }));
}

const session = (role: Session['role']): Session => ({ userId: 'u', role, accessToken: 't' });

beforeEach(() => getSession.mockReset());

describe('MarketingChrome "Open dashboard"', () => {
  it('sends an EMPLOYEE to /me, not the overview they cannot open', async () => {
    getSession.mockResolvedValue(session('EMPLOYEE'));
    expect(await render()).toMatch(/<a [^>]*href="\/me"[^>]*>\s*Open dashboard/);
  });

  it('sends a MANAGER to /overview', async () => {
    getSession.mockResolvedValue(session('MANAGER'));
    expect(await render()).toMatch(/<a [^>]*href="\/overview"[^>]*>\s*Open dashboard/);
  });

  it('shows Sign in when there is no session', async () => {
    getSession.mockResolvedValue(null);
    expect(await render()).toMatch(/<a [^>]*href="\/login"[^>]*>\s*Sign in/);
  });
});
