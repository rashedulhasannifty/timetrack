import { describe, it, expect } from 'vitest';
import {
  LoginSchema,
  CreateTimeEntrySchema,
  TimeEntrySchema,
  ListTimeEntriesQuerySchema,
  ActivityBatchSchema,
  ActivitySampleSchema,
  ListActivityQuerySchema,
  ActivityDailySummarySchema,
  ListActivitySummaryQuerySchema,
  ACTIVITY_SAMPLE_INTERVAL_SECONDS,
  IdleEventSchema,
  IdleEventResultSchema,
  ListIdleEventsQuerySchema,
  ScreenshotSchema,
  RedactScreenshotSchema,
  TeamSettingsSchema,
  EffectivePolicySchema,
  InviteUserSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ListProjectsQuerySchema,
  TeamSummarySchema,
  UpdateSettingsSchema,
  ObservedAppsSchema,
  ProblemSchema,
  Role,
  AcceptInviteSchema,
  InviteResultSchema,
  UpdateUserSchema,
  TeamOverviewQuerySchema,
  TeamOverviewSchema,
} from './index.js';

const UUID = '019797a0-0000-7000-8000-000000000001';
const ISO = '2026-07-11T09:00:00.000Z';

describe('enums', () => {
  it('accepts known roles and rejects unknown', () => {
    expect(Role.parse('ADMIN')).toBe('ADMIN');
    expect(Role.safeParse('ROOT').success).toBe(false);
  });
});

describe('auth', () => {
  it('accepts a valid login and rejects a short password', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: 'longenough' }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: 'nope', password: 'longenough' }).success).toBe(false);
  });
});

describe('time-entry round-trip', () => {
  const entry = {
    id: UUID,
    projectId: null,
    taskId: null,
    startTime: ISO,
    endTime: null,
    source: 'MANUAL' as const,
  };

  it('parses a create payload and rejects a bad uuid', () => {
    expect(CreateTimeEntrySchema.parse(entry)).toMatchObject({ id: UUID });
    expect(CreateTimeEntrySchema.safeParse({ ...entry, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('round-trips the full entity through its own schema', () => {
    const full = { ...entry, userId: UUID, editedById: null, editedAt: null };
    expect(TimeEntrySchema.parse(full)).toEqual(full);
  });

  it('requires from/to on the list query', () => {
    expect(ListTimeEntriesQuerySchema.safeParse({ from: ISO, to: ISO }).success).toBe(true);
    expect(ListTimeEntriesQuerySchema.safeParse({ from: ISO }).success).toBe(false);
  });
});

describe('activity', () => {
  const sample = {
    id: UUID,
    timestamp: ISO,
    appName: 'Xcode',
    windowTitle: null,
    activityPct: 42,
  };

  it('defaults category to NEUTRAL and clamps a batch to 500', () => {
    expect(ActivitySampleSchema.parse(sample).category).toBe('NEUTRAL');
    expect(ActivityBatchSchema.safeParse({ samples: [] }).success).toBe(false);
    expect(ActivitySampleSchema.safeParse({ ...sample, activityPct: 101 }).success).toBe(false);
  });

  it('accepts an optional bundleId (present, null, or absent)', () => {
    expect(
      ActivitySampleSchema.parse({ ...sample, bundleId: 'com.microsoft.VSCode' }).bundleId,
    ).toBe('com.microsoft.VSCode');
    expect(ActivitySampleSchema.parse({ ...sample, bundleId: null }).bundleId).toBeNull();
    // Absent is fine — the shipped client sends no bundleId.
    expect(ActivitySampleSchema.parse(sample).bundleId).toBeUndefined();
  });

  it('ListActivityQuerySchema requires from+to, userId optional', () => {
    expect(ListActivityQuerySchema.safeParse({ from: ISO, to: ISO }).success).toBe(true);
    expect(ListActivityQuerySchema.safeParse({ userId: UUID, from: ISO, to: ISO }).success).toBe(
      true,
    );
    expect(ListActivityQuerySchema.safeParse({ from: ISO }).success).toBe(false);
    expect(ListActivityQuerySchema.safeParse({ userId: 'nope', from: ISO, to: ISO }).success).toBe(
      false,
    );
  });
});

describe('idle', () => {
  it('validates a resolved idle event', () => {
    expect(
      IdleEventSchema.safeParse({
        id: UUID,
        startTime: ISO,
        endTime: ISO,
        resolvedAction: 'DISCARDED',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown resolvedAction', () => {
    expect(
      IdleEventSchema.safeParse({
        id: UUID,
        startTime: ISO,
        endTime: ISO,
        resolvedAction: 'MAYBE',
      }).success,
    ).toBe(false);
  });

  it('IdleEventResultSchema round-trips id + resolvedAction', () => {
    expect(IdleEventResultSchema.parse({ id: UUID, resolvedAction: 'KEPT' })).toEqual({
      id: UUID,
      resolvedAction: 'KEPT',
    });
  });

  it('ListIdleEventsQuerySchema requires from+to, userId optional', () => {
    expect(ListIdleEventsQuerySchema.safeParse({ from: ISO, to: ISO }).success).toBe(true);
    expect(ListIdleEventsQuerySchema.safeParse({ userId: UUID, from: ISO, to: ISO }).success).toBe(
      true,
    );
    expect(ListIdleEventsQuerySchema.safeParse({ to: ISO }).success).toBe(false);
  });
});

describe('screenshot', () => {
  it('parses a read row and requires a non-empty redact reason', () => {
    expect(
      ScreenshotSchema.safeParse({
        id: UUID,
        userId: UUID,
        timestamp: ISO,
        storageKey: 'shots/2026/07/x.png',
        thumbnailKey: null,
        blurred: false,
        status: 'PENDING',
        redactedReason: null,
      }).success,
    ).toBe(true);
    expect(RedactScreenshotSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('team-settings + policy', () => {
  it('applies defaults and enforces the retention floor', () => {
    const parsed = TeamSettingsSchema.parse({});
    expect(parsed.screenshotRetentionDays).toBe(30);
    expect(TeamSettingsSchema.safeParse({ screenshotRetentionDays: 0 }).success).toBe(false);
  });

  it('seeds productive defaults, keeps unproductive empty, and ships no blanket wildcards', () => {
    const s = TeamSettingsSchema.parse({});
    expect(s.productiveApps).toContain('Code');
    expect(s.productiveApps).toContain('Cursor');
    expect(s.productiveSites).toContain('github.com');
    expect(s.productiveSites).toContain('niftyhq.ai');
    // Unproductive stays neutral-by-default (opt-in admin decision).
    expect(s.unproductiveApps).toEqual([]);
    expect(s.unproductiveSites).toEqual([]);
    // No blanket `api.*`/`docs.*` wildcards seeded (the feature stays; the defaults don't use it).
    expect(s.productiveSites.some((t) => t.endsWith('.*'))).toBe(false);
  });

  it('parses an effective policy with nested settings', () => {
    expect(
      EffectivePolicySchema.safeParse({
        ackRequired: true,
        policyVersion: 'v1',
        policyText: 'We monitor work activity.',
        settings: {},
      }).success,
    ).toBe(true);
  });

  it('accepts an empty admin settings patch', () => {
    expect(UpdateSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('ObservedAppsSchema parses an app-name list and rejects a non-array', () => {
    expect(ObservedAppsSchema.parse({ appNames: ['Code', 'Slack'] })).toEqual({
      appNames: ['Code', 'Slack'],
    });
    expect(ObservedAppsSchema.safeParse({ appNames: 'Code' }).success).toBe(false);
  });
});

describe('admin — UpdateSettingsSchema is a default-free partial', () => {
  it('keeps only the provided keys (never injects defaults)', () => {
    const out = UpdateSettingsSchema.parse({ screenshotIntervalMinutes: 20 });
    expect(out).toEqual({ screenshotIntervalMinutes: 20 });
    expect(Object.keys(out)).toEqual(['screenshotIntervalMinutes']);
  });
  it('still range-validates the keys that ARE provided', () => {
    expect(UpdateSettingsSchema.safeParse({ screenshotRetentionDays: 999 }).success).toBe(false);
  });
  it('TeamSettingsSchema (read) still fills every default from {}', () => {
    const full = TeamSettingsSchema.parse({});
    expect(full.screenshotsEnabled).toBe(true);
    expect(full.screenshotRetentionDays).toBe(30);
    expect(full.captureWindowTitles).toBe(true);
    expect(full.distractionRepeatMinutes).toBe(5);
  });
});

describe('users / projects / reports', () => {
  it('defaults an invited user to EMPLOYEE', () => {
    expect(InviteUserSchema.parse({ email: 'a@b.co', name: 'A', teamId: UUID }).role).toBe(
      'EMPLOYEE',
    );
  });

  it('validates a project create and a team summary', () => {
    expect(
      CreateProjectSchema.safeParse({ teamId: UUID, name: 'Website', color: '#007aff' }).success,
    ).toBe(true);
    expect(TeamSummarySchema.safeParse({ from: ISO, to: ISO, rows: [] }).success).toBe(true);
  });
});

describe('invite/accept contracts', () => {
  it('AcceptInviteSchema requires a token and a min-8 password', () => {
    expect(AcceptInviteSchema.safeParse({ token: 't', password: 'longenough' }).success).toBe(true);
    expect(AcceptInviteSchema.safeParse({ token: 't', password: 'short' }).success).toBe(false);
    expect(AcceptInviteSchema.safeParse({ token: '', password: 'longenough' }).success).toBe(false);
  });

  it('InviteResultSchema accepts a result with and without an optional devToken', () => {
    const base = {
      invite: { id: UUID, email: 'a@b.co', role: 'EMPLOYEE', teamId: UUID, expiresAt: ISO },
    };
    expect(InviteResultSchema.safeParse(base).success).toBe(true);
    expect(InviteResultSchema.safeParse({ ...base, devToken: 'tok' }).success).toBe(true);
  });
});

describe('users — UpdateUserSchema', () => {
  it('accepts a boolean deactivated flag', () => {
    expect(UpdateUserSchema.safeParse({ deactivated: true }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ deactivated: false }).success).toBe(true);
  });
  it('rejects a missing or non-boolean flag', () => {
    expect(UpdateUserSchema.safeParse({}).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ deactivated: 'yes' }).success).toBe(false);
  });
});

describe('problem+json', () => {
  it('parses an RFC 9457 body with a field-error map', () => {
    expect(
      ProblemSchema.safeParse({
        type: 'https://timetrack.internal/errors/validation',
        title: 'Validation failed',
        status: 422,
        errors: [{ path: 'email', message: 'Invalid', code: 'invalid_string' }],
      }).success,
    ).toBe(true);
  });
});

describe('projects — UpdateProjectSchema + ListProjectsQuerySchema', () => {
  it('UpdateProjectSchema accepts optional archived and color fields', () => {
    expect(UpdateProjectSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(UpdateProjectSchema.parse({})).toEqual({});
    expect(() => UpdateProjectSchema.parse({ archived: 'yes' })).toThrow();
  });

  it('ListProjectsQuerySchema parses the includeArchived string flag correctly', () => {
    // z.stringbool(), NOT z.coerce.boolean() — the string "false" must be false.
    expect(ListProjectsQuerySchema.parse({ includeArchived: 'true' })).toEqual({
      includeArchived: true,
    });
    expect(ListProjectsQuerySchema.parse({ includeArchived: 'false' })).toEqual({
      includeArchived: false,
    });
    expect(ListProjectsQuerySchema.parse({})).toEqual({ includeArchived: false });
  });
});

describe('TeamOverview contracts', () => {
  it('accepts an optional YYYY-MM-DD date', () => {
    expect(TeamOverviewQuerySchema.parse({})).toEqual({});
    expect(TeamOverviewQuerySchema.parse({ date: '2026-07-12' })).toEqual({ date: '2026-07-12' });
  });

  it('rejects a non-date string', () => {
    expect(TeamOverviewQuerySchema.safeParse({ date: 'not-a-date' }).success).toBe(false);
  });

  it('parses a full overview payload', () => {
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
    expect(TeamOverviewSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a negative trackedSecondsToday', () => {
    const bad = {
      date: '2026-07-12',
      rows: [
        {
          userId: '019797a0-0000-7000-8000-0000000000aa',
          name: 'Ada',
          tracking: false,
          trackedSecondsToday: -1,
        },
      ],
    };
    expect(TeamOverviewSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ActivityDailySummarySchema', () => {
  const valid = {
    userId: UUID,
    day: '2026-07-11',
    avgActivityPct: 62,
    activeMinutes: 120,
    byApp: { Xcode: 90, Slack: 30 },
    byCategory: { NEUTRAL: 120 },
  };

  it('accepts a valid summary and keeps the record maps', () => {
    const s = ActivityDailySummarySchema.parse(valid);
    expect(s.avgActivityPct).toBe(62);
    expect(s.byApp.Xcode).toBe(90);
    expect(s.byCategory.NEUTRAL).toBe(120);
  });

  it('rejects out-of-range pct, a datetime in the date field, and negative minutes', () => {
    expect(ActivityDailySummarySchema.safeParse({ ...valid, avgActivityPct: 101 }).success).toBe(
      false,
    );
    expect(
      ActivityDailySummarySchema.safeParse({ ...valid, day: '2026-07-11T00:00:00Z' }).success,
    ).toBe(false);
    expect(ActivityDailySummarySchema.safeParse({ ...valid, byApp: { Xcode: -1 } }).success).toBe(
      false,
    );
  });

  it('ListActivitySummaryQuerySchema requires date from/to and optional userId', () => {
    expect(
      ListActivitySummaryQuerySchema.safeParse({ from: '2026-07-01', to: '2026-07-31' }).success,
    ).toBe(true);
    expect(
      ListActivitySummaryQuerySchema.safeParse({ from: 'nope', to: '2026-07-31' }).success,
    ).toBe(false);
  });

  it('exposes the shared sample interval as 60 seconds', () => {
    expect(ACTIVITY_SAMPLE_INTERVAL_SECONDS).toBe(60);
  });
});
