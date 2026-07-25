import { describe, it, expect } from 'vitest';
import { toTrendBars, toMemberBars, toTaskBars } from './project-detail-view';

describe('toTrendBars', () => {
  it('maps day → MM-DD label and seconds → rounded hours', () => {
    expect(toTrendBars([{ day: '2026-07-13', trackedSeconds: 5400 }])).toEqual([
      { label: '07-13', hours: 1.5 },
    ]);
  });
  it('empty in → empty out', () => {
    expect(toTrendBars([])).toEqual([]);
  });
});

describe('toMemberBars', () => {
  it('maps name + seconds → hours', () => {
    expect(toMemberBars([{ userId: 'u1', name: 'Jane', trackedSeconds: 3600 }])).toEqual([
      { name: 'Jane', hours: 1 },
    ]);
  });
});

describe('toTaskBars', () => {
  it('maps task name (incl. "No task") + seconds → hours', () => {
    expect(toTaskBars([{ taskId: null, name: 'No task', trackedSeconds: 1800 }])).toEqual([
      { name: 'No task', hours: 0.5 },
    ]);
  });
});
