import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, ApiError } from './api-client';

afterEach(() => vi.restoreAllMocks());

const USER = {
  id: '019797a0-0000-7000-8000-0000000000aa',
  email: 'ada@example.com',
  name: 'Ada',
  role: 'EMPLOYEE' as const,
  teamId: '019797a0-0000-7000-8000-0000000000bb',
  monitoringAckAt: null,
  deactivatedAt: null,
  createdAt: '2026-07-12T00:00:00.000Z',
};

describe('api.inviteUser', () => {
  it('parses the InviteResult on 201', async () => {
    const payload = {
      invite: {
        id: '019797a0-0000-7000-8000-0000000000cc',
        email: 'ada@example.com',
        role: 'EMPLOYEE',
        teamId: USER.teamId,
        expiresAt: '2026-07-15T00:00:00.000Z',
      },
      devToken: 'dev-token',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(payload), { status: 201 })),
    );
    expect(
      await api.inviteUser('tok', {
        email: 'ada@example.com',
        name: 'Ada',
        role: 'EMPLOYEE',
        teamId: USER.teamId,
      }),
    ).toEqual(payload);
  });

  it('throws an ApiError carrying the problem+json title on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'A user with this email already exists' }), {
            status: 409,
          }),
      ),
    );
    await expect(
      api.inviteUser('tok', {
        email: 'ada@example.com',
        name: 'Ada',
        role: 'EMPLOYEE',
        teamId: USER.teamId,
      }),
    ).rejects.toMatchObject({ status: 409, message: 'A user with this email already exists' });
  });
});

describe('api.setUserActive', () => {
  it('sends the deactivated flag and returns the parsed User', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ...USER, deactivatedAt: '2026-07-12T01:00:00.000Z' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.setUserActive('tok', USER.id, true);
    expect(result.deactivatedAt).toBe('2026-07-12T01:00:00.000Z');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ deactivated: true }) });
  });

  it('surfaces the last-admin 409 as an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'Cannot deactivate the last active admin' }), {
            status: 409,
          }),
      ),
    );
    await expect(api.setUserActive('tok', USER.id, true)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.updateTeamSettings', () => {
  it('parses the returned TeamSettings on 200', async () => {
    const settings = {
      screenshotsEnabled: true,
      screenshotIntervalMinutes: 15,
      screenshotBlur: 'NONE',
      screenshotRetentionDays: 30,
      activityRetentionDays: 90,
      idleThresholdMinutes: 5,
      captureWindowTitles: true,
      autoStartOnLogin: false,
      distractionAlertsEnabled: false,
      unproductiveApps: [],
      productiveApps: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(settings), { status: 200 })),
    );
    expect(await api.updateTeamSettings('tok', { screenshotIntervalMinutes: 15 })).toEqual(
      settings,
    );
  });
});

describe('api.login', () => {
  it('returns the parsed TokenPair on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }), {
            status: 200,
          }),
      ),
    );
    expect(await api.login('user@example.com', 'password12')).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
    });
  });

  it('returns null on 401 (bad credentials) without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('unauthorized', { status: 401 })),
    );
    expect(await api.login('user@example.com', 'wrong')).toBeNull();
  });
});

describe('api.refresh', () => {
  it('returns null when the refresh token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('nope', { status: 401 })),
    );
    expect(await api.refresh('revoked')).toBeNull();
  });
});

describe('api.teamOverview', () => {
  it('parses the overview payload on 200', async () => {
    const payload = {
      date: '2026-07-12',
      rows: [
        {
          userId: '019797a0-0000-7000-8000-0000000000aa',
          name: 'Ada',
          tracking: true,
          trackedSecondsToday: 3600,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(payload), { status: 200 })),
    );
    expect(await api.teamOverview('tok', '2026-07-12')).toEqual(payload);
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('nope', { status: 403 })),
    );
    await expect(api.teamOverview('tok')).rejects.toThrow();
  });
});
