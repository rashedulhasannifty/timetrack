import { describe, it, expect } from 'vitest';
import { idlePeriodRows } from './idle-view';
import type { IdleEvent } from '@timetrack/contracts';

const event = (over: Partial<IdleEvent>): IdleEvent => ({
  id: '11111111-1111-4111-8111-111111111111',
  startTime: '2026-07-24T14:20:00.000Z',
  endTime: '2026-07-24T14:37:00.000Z',
  resolvedAction: 'KEPT',
  ...over,
});

describe('idlePeriodRows', () => {
  it('formats the window and its length', () => {
    const [row] = idlePeriodRows([event({})]);
    expect(row!.range).toBe('14:20–14:37');
    expect(row!.duration).toBe('17m');
  });

  it('sorts by start time regardless of input order', () => {
    const rows = idlePeriodRows([
      event({
        id: 'b',
        startTime: '2026-07-24T16:00:00.000Z',
        endTime: '2026-07-24T16:10:00.000Z',
      }),
      event({
        id: 'a',
        startTime: '2026-07-24T09:00:00.000Z',
        endTime: '2026-07-24T09:10:00.000Z',
      }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('names what the client decided, and flags the ones it has not', () => {
    expect(idlePeriodRows([event({ resolvedAction: 'DISCARDED' })])[0]!.outcome).toMatch(
      /discarded/i,
    );
    const pending = idlePeriodRows([event({ resolvedAction: 'UNRESOLVED' })])[0]!;
    expect(pending.unresolved).toBe(true);
    expect(idlePeriodRows([event({ resolvedAction: 'KEPT' })])[0]!.unresolved).toBe(false);
  });

  it('never reports a negative length for an inverted window', () => {
    const row = idlePeriodRows([
      event({ startTime: '2026-07-24T14:37:00.000Z', endTime: '2026-07-24T14:20:00.000Z' }),
    ])[0]!;
    expect(row.duration).toBe('0m');
  });

  it('is empty for no events', () => {
    expect(idlePeriodRows([])).toEqual([]);
  });
});
