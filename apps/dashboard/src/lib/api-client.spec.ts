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

describe('api.setUserRole', () => {
  it('sends the role and returns the parsed User', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ...USER, role: 'MANAGER' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.setUserRole('tok', USER.id, 'MANAGER');
    expect(result.role).toBe('MANAGER');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ role: 'MANAGER' }) });
  });

  it('surfaces the last-admin 409 as an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'Cannot demote the last active admin' }), {
            status: 409,
          }),
      ),
    );
    await expect(api.setUserRole('tok', USER.id, 'EMPLOYEE')).rejects.toBeInstanceOf(ApiError);
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
      distractionRepeatMinutes: 5,
      timesheetReminderHours: 0,
      unproductiveApps: [],
      productiveApps: [],
      unproductiveSites: [],
      productiveSites: [],
    };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(settings), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await api.updateTeamSettings('tok', 'team-9', { screenshotIntervalMinutes: 15 }),
    ).toEqual(settings);
  });

  it('addresses the team named in the call, not the caller’s own team', async () => {
    // The whole point of the team-scoped route: the id must reach the URL. Sending this to
    // /admin/settings would write whichever team the access token belongs to.
    const fetchMock = vi.fn(
      (url: string | URL) => new Response(JSON.stringify({ url: String(url) }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.updateTeamSettings('tok', 'team-9', {}).catch(() => undefined);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/teams/team-9/settings');
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

describe('api.redactScreenshot', () => {
  const tombstone = {
    id: '019f6ffe-910f-70e7-a56d-3ee574d99d7e',
    userId: '019f6fe4-06bb-755d-b9b8-ebbfc1a77159',
    timestamp: '2026-07-17T12:13:02.000Z',
    storageKey: 'raw/019f6fe4/019f6ffe',
    thumbnailKey: null,
    blurred: false,
    status: 'REDACTED',
    redactedReason: 'personal message visible',
  };

  it('POSTs the reason and parses the REDACTED tombstone', async () => {
    const fetchMock = vi.fn(() => new Response(JSON.stringify(tombstone), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.redactScreenshot('tok', tombstone.id, {
      reason: 'personal message visible',
    });

    expect(out.status).toBe('REDACTED');
    expect(out.redactedReason).toBe('personal message visible');
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toContain(`/v1/screenshots/${tombstone.id}/redact`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'personal message visible' });
  });

  it('throws an ApiError on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify({ title: 'not your screenshot' }), { status: 403 })),
    );
    await expect(api.redactScreenshot('tok', tombstone.id, { reason: 'x' })).rejects.toMatchObject({
      status: 403,
      message: 'not your screenshot',
    });
  });
});

describe('api.listActivitySummaries', () => {
  const row = {
    userId: '019797a0-0000-7000-8000-0000000000aa',
    day: '2026-07-17',
    avgActivityPct: 62,
    activeMinutes: 240,
    byApp: { Code: 180, Slack: 60 },
    byCategory: { PRODUCTIVE: 180, NEUTRAL: 60 },
  };

  it('parses the summary array on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify([row]), { status: 200 })),
    );
    const params = new URLSearchParams({
      userId: row.userId,
      from: '2026-07-11',
      to: '2026-07-17',
    });
    expect(await api.listActivitySummaries('tok', params)).toEqual([row]);
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('nope', { status: 403 })),
    );
    await expect(
      api.listActivitySummaries(
        'tok',
        new URLSearchParams({ from: '2026-07-11', to: '2026-07-17' }),
      ),
    ).rejects.toThrow();
  });
});

describe('api.teamSummary', () => {
  it('hits /reports/team-summary and parses the response', async () => {
    const body = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z', rows: [] };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const params = new URLSearchParams({ from: body.from, to: body.to });
    const result = await api.teamSummary('tok', params);

    expect(result).toEqual(body);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/reports/team-summary?from=');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('rejects with an ApiError carrying status 403 on a 403 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'You are not permitted to view this team' }), {
            status: 403,
          }),
      ),
    );
    const params = new URLSearchParams({ from: '2026-07-01', to: '2026-07-08' });
    await expect(api.teamSummary('tok', params)).rejects.toBeInstanceOf(ApiError);
    await expect(api.teamSummary('tok', params)).rejects.toMatchObject({
      status: 403,
      message: 'You are not permitted to view this team',
    });
  });

  it('rejects with an ApiError carrying status 500 on a 500 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('internal error', { status: 500 })),
    );
    const params = new URLSearchParams({ from: '2026-07-01', to: '2026-07-08' });
    await expect(api.teamSummary('tok', params)).rejects.toMatchObject({ status: 500 });
  });
});

describe('api.projectSummary', () => {
  it('hits /reports/projects and parses the response', async () => {
    const body = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-08T00:00:00.000Z',
      rows: [{ projectId: null, name: 'No project', trackedSeconds: 120 }],
    };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const params = new URLSearchParams({ from: body.from, to: body.to });
    const result = await api.projectSummary('tok', params);

    expect(result).toEqual(body);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url] = call as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/reports/projects?from=');
  });
});

describe('api.exportReportCsv', () => {
  it('hits /reports/export.csv with the bearer token and forwarded params', async () => {
    const fetchMock = vi.fn(() => new Response('csv', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const params = new URLSearchParams({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-08T00:00:00.000Z',
      teamId: 't1',
    });
    const res = await api.exportReportCsv('tok', params);

    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toBe(
      'http://localhost:3001/v1/reports/export.csv?from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-08T00%3A00%3A00.000Z&teamId=t1',
    );
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });
});

describe('api.listApprovals', () => {
  it('GETs /v1/approvals with status query param and bearer header', async () => {
    const approval = {
      id: '019797a0-0000-7000-8000-0000000000aa',
      userId: '019797a0-0000-7000-8000-0000000000bb',
      userName: 'Ada',
      periodStart: '2026-06-29T00:00:00.000Z',
      periodEnd: '2026-07-06T00:00:00.000Z',
      status: 'PENDING' as const,
      trackedSeconds: 5400,
      totalSeconds: null,
      reviewerId: null,
      note: null,
      decidedAt: null,
    };
    const fetchMock = vi.fn(() => new Response(JSON.stringify([approval]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const params = new URLSearchParams({ status: 'PENDING' });
    const result = await api.listApprovals('tok', params);

    expect(result).toEqual([approval]);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/approvals?status=PENDING');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('throws an ApiError on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify({ title: 'not permitted' }), { status: 403 })),
    );
    await expect(
      api.listApprovals('tok', new URLSearchParams({ status: 'PENDING' })),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.decideApproval', () => {
  it('POSTs to /v1/approvals/<id>/decide with bearer header and JSON body', async () => {
    const approval = {
      id: '019797a0-0000-7000-8000-0000000000aa',
      userId: '019797a0-0000-7000-8000-0000000000bb',
      userName: 'Ada',
      periodStart: '2026-06-29T00:00:00.000Z',
      periodEnd: '2026-07-06T00:00:00.000Z',
      status: 'APPROVED' as const,
      trackedSeconds: 5400,
      totalSeconds: 5400,
      reviewerId: '019797a0-0000-7000-8000-0000000000cc',
      note: 'looks good',
      decidedAt: '2026-07-17T12:00:00.000Z',
    };
    const fetchMock = vi.fn(() => new Response(JSON.stringify(approval), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.decideApproval('tok', approval.id, {
      status: 'APPROVED',
      note: 'looks good',
    });

    expect(result).toEqual(approval);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(String(url)).toContain(`/v1/approvals/${approval.id}/decide`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
    expect(JSON.parse(init.body as string)).toEqual({ status: 'APPROVED', note: 'looks good' });
  });

  it('throws an ApiError on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify({ title: 'approval not found' }), { status: 404 })),
    );
    await expect(
      api.decideApproval('tok', 'nonexistent', { status: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.trends', () => {
  it('parses TeamTrends on 200', async () => {
    const payload = {
      from: '2026-07-11T00:00:00.000Z',
      to: '2026-07-13T00:00:00.000Z',
      days: [
        {
          day: '2026-07-12',
          trackedSeconds: 3600,
          productiveSeconds: 1800,
          neutralSeconds: 0,
          unproductiveSeconds: 0,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(payload), { status: 200 })),
    );
    expect(
      await api.trends('tok', new URLSearchParams({ from: payload.from, to: payload.to })),
    ).toEqual(payload);
  });
});
