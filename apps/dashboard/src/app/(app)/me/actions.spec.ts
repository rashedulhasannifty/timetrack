import { describe, it, expect, vi, beforeEach } from 'vitest';

const { revalidatePath, getSession, redactScreenshot, updateTimeEntry, createManualTimeEntry } =
  vi.hoisted(() => ({
    updateTimeEntry: vi.fn(),
    createManualTimeEntry: vi.fn(),
    revalidatePath: vi.fn(),
    getSession: vi.fn(),
    redactScreenshot: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../../../lib/session', () => ({ getSession }));
vi.mock('../../../lib/api-client', () => ({
  api: { redactScreenshot, updateTimeEntry, createManualTimeEntry },
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

import { redactScreenshotAction, updateEntryAction, createManualEntryAction } from './actions';

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

describe('entry assignment', () => {
  const P = '018f9c1e-0000-7000-8000-000000000001';
  const C = '018f9c1e-0000-7000-8000-000000000003';
  const T = '018f9c1e-0000-7000-8000-000000000004';
  const form = (assignment: string, extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('id', 'e1');
    f.set('day', '2026-08-24');
    f.set('start', '09:00');
    f.set('end', '10:00');
    f.set('assignment', assignment);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };
  const prev = { ok: false } as never;

  it.each([
    [
      'updateEntryAction',
      updateEntryAction,
      () => updateTimeEntry,
      (c: unknown[] | undefined) => c?.[2],
    ],
    [
      'createManualEntryAction',
      createManualEntryAction,
      () => createManualTimeEntry,
      (c: unknown[] | undefined) => c?.[1],
    ],
  ] as const)(
    '%s sends the chosen project, subproject and task',
    async (_n, action, mock, body) => {
      mock().mockResolvedValue({});
      expect(await action(prev, form(`${P}|${C}|${T}`))).toEqual({ ok: true });
      expect(body(mock().mock.calls[0])).toMatchObject({
        projectId: P,
        subprojectId: C,
        taskId: T,
      });
    },
  );

  it.each([
    [
      'updateEntryAction',
      updateEntryAction,
      () => updateTimeEntry,
      (c: unknown[] | undefined) => c?.[2],
    ],
    [
      'createManualEntryAction',
      createManualEntryAction,
      () => createManualTimeEntry,
      (c: unknown[] | undefined) => c?.[1],
    ],
  ] as const)('%s sends all three null for "No project"', async (_n, action, mock, body) => {
    mock().mockResolvedValue({});
    await action(prev, form(''));
    expect(body(mock().mock.calls[0])).toMatchObject({
      projectId: null,
      subprojectId: null,
      taskId: null,
    });
  });

  it.each([
    ['updateEntryAction', updateEntryAction, () => updateTimeEntry],
    ['createManualEntryAction', createManualEntryAction, () => createManualTimeEntry],
  ] as const)(
    '%s refuses a malformed assignment without calling the API',
    async (_n, action, mock) => {
      expect(await action(prev, form('garbage'))).toEqual({
        ok: false,
        message: 'Pick a project.',
      });
      expect(mock()).not.toHaveBeenCalled();
    },
  );
});
