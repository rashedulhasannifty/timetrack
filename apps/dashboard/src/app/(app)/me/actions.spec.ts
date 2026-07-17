import { describe, it, expect, vi, beforeEach } from 'vitest';

const { revalidatePath, getSession, redactScreenshot } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getSession: vi.fn(),
  redactScreenshot: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../../../lib/session', () => ({ getSession }));
vi.mock('../../../lib/api-client', () => ({ api: { redactScreenshot } }));

import { redactScreenshotAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: 'u1', role: 'EMPLOYEE', accessToken: 'tok' });
});

describe('redactScreenshotAction', () => {
  it('redacts with the trimmed reason and revalidates /me on success', async () => {
    redactScreenshot.mockResolvedValue({ status: 'REDACTED' });
    const res = await redactScreenshotAction('shot-1', '  personal info  ');
    expect(res).toEqual({ ok: true });
    expect(redactScreenshot).toHaveBeenCalledWith('tok', 'shot-1', { reason: 'personal info' });
    expect(revalidatePath).toHaveBeenCalledWith('/me');
  });

  it('rejects an empty or whitespace-only reason without calling the API', async () => {
    for (const reason of ['', '   ']) {
      const res = await redactScreenshotAction('shot-1', reason);
      expect(res).toEqual({ ok: false, error: 'A reason is required.' });
    }
    expect(redactScreenshot).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps an API error to a generic message and does not revalidate', async () => {
    redactScreenshot.mockRejectedValue(new Error('boom'));
    const res = await redactScreenshotAction('shot-1', 'valid reason');
    expect(res).toEqual({ ok: false, error: 'Could not redact — try again.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns not-signed-in when there is no session', async () => {
    getSession.mockResolvedValue(null);
    const res = await redactScreenshotAction('shot-1', 'valid reason');
    expect(res).toEqual({ ok: false, error: 'Not signed in.' });
    expect(redactScreenshot).not.toHaveBeenCalled();
  });
});
