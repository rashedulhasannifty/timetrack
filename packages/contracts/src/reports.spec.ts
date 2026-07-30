import { describe, it, expect } from 'vitest';
import {
  ProjectSummarySchema,
  ProjectSummaryRowSchema,
  TeamTrendsSchema,
  TeamActivityRowSchema,
  TeamAppUsageRowSchema,
  AppUsageQuerySchema,
} from './reports.js';

describe('ProjectSummarySchema', () => {
  it('accepts a valid payload including a null-projectId (No project) row', () => {
    const parsed = ProjectSummarySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-08T00:00:00.000Z',
      rows: [
        { projectId: '019797a0-0000-7000-8000-000000000001', name: 'Acme', trackedSeconds: 3600 },
        { projectId: null, name: 'No project', trackedSeconds: 120 },
      ],
    });
    expect(parsed.rows).toHaveLength(2);
  });

  it('rejects a negative trackedSeconds', () => {
    expect(() =>
      ProjectSummaryRowSchema.parse({ projectId: null, name: 'No project', trackedSeconds: -1 }),
    ).toThrow();
  });

  it('rejects a non-uuid projectId', () => {
    expect(() =>
      ProjectSummaryRowSchema.parse({ projectId: 'nope', name: 'X', trackedSeconds: 0 }),
    ).toThrow();
  });
});

describe('TeamTrendsSchema', () => {
  it('accepts a zero-filled day', () => {
    const parsed = TeamTrendsSchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      days: [
        {
          day: '2026-07-01',
          trackedSeconds: 0,
          productiveSeconds: 0,
          neutralSeconds: 0,
          unproductiveSeconds: 0,
        },
      ],
    });
    expect(parsed.days).toHaveLength(1);
  });

  it('rejects a non-date day', () => {
    expect(() =>
      TeamTrendsSchema.parse({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        days: [
          {
            day: 'nope',
            trackedSeconds: 0,
            productiveSeconds: 0,
            neutralSeconds: 0,
            unproductiveSeconds: 0,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('TeamActivityRowSchema', () => {
  it('rejects a pct over 100', () => {
    expect(() =>
      TeamActivityRowSchema.parse({
        userId: '019797a0-0000-7000-8000-000000000001',
        name: 'Ada',
        activeMinutes: 10,
        productivePct: 101,
        neutralPct: 0,
        unproductivePct: 0,
        idleMinutes: 0,
        idlePct: 0,
      }),
    ).toThrow();
  });
});

describe('TeamAppUsageRowSchema', () => {
  it('accepts a valid row and rejects a bad category', () => {
    expect(
      TeamAppUsageRowSchema.parse({ appName: 'Code', seconds: 60, category: 'PRODUCTIVE' }).seconds,
    ).toBe(60);
    expect(() =>
      TeamAppUsageRowSchema.parse({ appName: 'Code', seconds: 60, category: 'MEH' }),
    ).toThrow();
  });
});

describe('AppUsageQuerySchema', () => {
  it('defaults limit to 10 and coerces a string limit', () => {
    const d = AppUsageQuerySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
    });
    expect(d.limit).toBe(10);
    const c = AppUsageQuerySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      limit: '5',
    });
    expect(c.limit).toBe(5);
  });
});
