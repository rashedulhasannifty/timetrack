import { describe, it, expect } from 'vitest';
import {
  LoginSchema,
  CreateTimeEntrySchema,
  TimeEntrySchema,
  ListTimeEntriesQuerySchema,
  ActivityBatchSchema,
  ActivitySampleSchema,
  IdleEventSchema,
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
  ProblemSchema,
  Role,
  AcceptInviteSchema,
  InviteResultSchema,
  UpdateUserSchema,
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
  });
});

describe('users / projects / reports', () => {
  it('defaults an invited user to EMPLOYEE', () => {
    expect(InviteUserSchema.parse({ email: 'a@b.co', name: 'A', teamId: UUID }).role).toBe(
      'EMPLOYEE',
    );
  });

  it('validates a project create and a team summary', () => {
    expect(CreateProjectSchema.safeParse({ teamId: UUID, name: 'Website' }).success).toBe(true);
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
  it('UpdateProjectSchema requires a boolean archived', () => {
    expect(UpdateProjectSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(() => UpdateProjectSchema.parse({})).toThrow();
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
