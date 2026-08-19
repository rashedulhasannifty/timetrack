import { describe, it, expect } from 'vitest';
import { idleRows, categoryMix } from './idle-view';
import type { IdleEvent } from '@timetrack/contracts';

const events: IdleEvent[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    startTime: '2026-07-24T10:48:00.000Z',
    endTime: '2026-07-24T11:05:00.000Z',
    resolvedAction: 'UNRESOLVED',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    startTime: '2026-07-24T12:30:00.000Z',
    endTime: '2026-07-24T13:15:00.000Z',
    resolvedAction: 'KEPT',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    startTime: '2026-07-24T15:22:00.000Z',
    endTime: '2026-07-24T15:31:00.000Z',
    resolvedAction: 'DISCARDED',
  },
];

describe('idleRows', () => {
  it('orders the longest period first', () => {
    expect(idleRows(events).map((r) => r.durationSeconds)).toEqual([2700, 1020, 540]);
  });

  it('renders the range as UTC HH:MM', () => {
    expect(idleRows(events)[1]!.range).toBe('10:48 – 11:05');
  });

  it('maps each outcome to its own note and tone', () => {
    const byId = new Map(idleRows(events).map((r) => [r.outcome, r]));
    expect(byId.get('KEPT')!.tone).toBe('good');
    expect(byId.get('DISCARDED')!.tone).toBe('neutral');
    expect(byId.get('UNRESOLVED')!.tone).toBe('warning');
    expect(byId.get('UNRESOLVED')!.note).toMatch(/not answered/i);
  });

  it('never reports a negative duration for an inverted pair', () => {
    const bad: IdleEvent[] = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        startTime: '2026-07-24T11:05:00.000Z',
        endTime: '2026-07-24T10:48:00.000Z',
        resolvedAction: 'KEPT',
      },
    ];
    expect(idleRows(bad)[0]!.durationSeconds).toBe(0);
  });

  it('returns nothing for a day with no idle periods', () => {
    expect(idleRows([])).toEqual([]);
  });
});

describe('categoryMix', () => {
  const s = (category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE') => ({ category });

  it('splits samples into three shares', () => {
    const mix = categoryMix([s('PRODUCTIVE'), s('PRODUCTIVE'), s('NEUTRAL'), s('UNPRODUCTIVE')]);
    expect(mix).toEqual({
      productivePct: 50,
      neutralPct: 25,
      unproductivePct: 25,
      sampled: 4,
    });
  });

  it('always totals exactly 100 so the stacked bar has no gap', () => {
    // Three equal thirds each round to 33 and would leave a 1% sliver of track showing.
    const mix = categoryMix([s('PRODUCTIVE'), s('NEUTRAL'), s('UNPRODUCTIVE')]);
    expect(mix.productivePct + mix.neutralPct + mix.unproductivePct).toBe(100);
  });

  it('gives the rounding remainder to the largest share', () => {
    const mix = categoryMix([
      s('PRODUCTIVE'),
      s('PRODUCTIVE'),
      s('PRODUCTIVE'),
      s('NEUTRAL'),
      s('UNPRODUCTIVE'),
      s('UNPRODUCTIVE'),
    ]);
    expect(mix.productivePct).toBe(50);
    expect(mix.productivePct + mix.neutralPct + mix.unproductivePct).toBe(100);
  });

  it('reports zero samples rather than dividing by zero', () => {
    expect(categoryMix([])).toEqual({
      productivePct: 0,
      neutralPct: 0,
      unproductivePct: 0,
      sampled: 0,
    });
  });
});
