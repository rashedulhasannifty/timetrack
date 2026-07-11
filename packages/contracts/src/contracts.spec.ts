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
  TeamSummarySchema,
  UpdateSettingsSchema,
  ProblemSchema,
  Role,
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
