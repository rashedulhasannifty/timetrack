import { describe, it, expect } from 'vitest';
import { formatDuration, formatDate, formatTimeRange } from './format';

describe('formatDuration', () => {
  it('shows hours and minutes above an hour', () => {
    expect(formatDuration(3 * 3600 + 25 * 60)).toBe('3h 25m');
  });
  it('shows only minutes under an hour and clamps negatives', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatDuration(-10)).toBe('0m');
  });
});

describe('formatDate / formatTimeRange', () => {
  it('formats an ISO date to YYYY-MM-DD', () => {
    expect(formatDate('2026-07-11T09:30:00.000Z')).toBe('2026-07-11');
  });
  it('renders an open-ended range while tracking', () => {
    expect(formatTimeRange('2026-07-11T09:00:00.000Z', null)).toBe('09:00–…');
    expect(formatTimeRange('2026-07-11T09:00:00.000Z', '2026-07-11T10:30:00.000Z')).toBe(
      '09:00–10:30',
    );
  });
});
