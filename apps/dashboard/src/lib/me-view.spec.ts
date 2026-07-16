import { describe, it, expect } from 'vitest';
import { toActivityPoints } from './me-view';
import type { ActivitySample } from '@timetrack/contracts';

const sample = (timestamp: string, activityPct: number): ActivitySample => ({
  id: '019797a0-0000-7000-8000-000000000001',
  timestamp,
  appName: 'Code',
  windowTitle: null,
  activityPct,
  category: 'NEUTRAL',
});

describe('toActivityPoints', () => {
  it('maps samples to {label HH:MM, activityPct} points, preserving order', () => {
    const points = toActivityPoints([
      sample('2026-07-11T09:00:00.000Z', 40),
      sample('2026-07-11T10:30:00.000Z', 75),
    ]);
    expect(points).toEqual([
      { label: '09:00', activityPct: 40 },
      { label: '10:30', activityPct: 75 },
    ]);
  });

  it('returns [] for no samples', () => {
    expect(toActivityPoints([])).toEqual([]);
  });
});
