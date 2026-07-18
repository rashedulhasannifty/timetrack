import { describe, it, expect } from 'vitest';
import { ProjectSummarySchema, ProjectSummaryRowSchema } from './reports.js';

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
