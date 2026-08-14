import { describe, expect, it } from 'vitest';
import { closedWeek, formatWeekRange, utcWeekStart } from './closed-week.js';

const iso = (d: Date) => d.toISOString();

describe('utcWeekStart', () => {
  it('returns the Monday of the containing week, in UTC', () => {
    // 2026-08-14 is a Friday; its ISO week starts Monday 2026-08-10.
    expect(iso(utcWeekStart(new Date('2026-08-14T23:59:59.999Z')))).toBe(
      '2026-08-10T00:00:00.000Z',
    );
  });

  it('treats Sunday as the END of its week, not the start', () => {
    // The classic off-by-one: getUTCDay() calls Sunday 0. ISO weeks are Monday-start, so
    // Sunday 2026-08-16 belongs to the week that began Monday 2026-08-10.
    expect(iso(utcWeekStart(new Date('2026-08-16T12:00:00Z')))).toBe('2026-08-10T00:00:00.000Z');
  });

  it('is a fixed point on a Monday at midnight', () => {
    const monday = new Date('2026-08-10T00:00:00.000Z');
    expect(iso(utcWeekStart(monday))).toBe(iso(monday));
  });
});

describe('closedWeek', () => {
  it('reports the previous week, never the one in progress', () => {
    const week = closedWeek(new Date('2026-08-12T09:00:00Z')); // Wednesday
    expect(iso(week.periodStart)).toBe('2026-08-03T00:00:00.000Z');
    expect(iso(week.periodEnd)).toBe('2026-08-10T00:00:00.000Z');
  });

  it('still reports the previous week when it runs early Monday morning', () => {
    // The scheduled case: 08:00 Monday is minutes into a brand-new week.
    const week = closedWeek(new Date('2026-08-10T08:00:00Z'));
    expect(iso(week.periodStart)).toBe('2026-08-03T00:00:00.000Z');
    expect(iso(week.periodEnd)).toBe('2026-08-10T00:00:00.000Z');
  });

  it('spans exactly seven days, half-open', () => {
    const week = closedWeek(new Date('2026-01-01T00:00:00Z'));
    const days = (week.periodEnd.getTime() - week.periodStart.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });
});

describe('formatWeekRange', () => {
  it('collapses a single-month week and excludes the exclusive end day', () => {
    // periodEnd is Monday the 10th; the week's last day is Sunday the 9th.
    expect(formatWeekRange(closedWeek(new Date('2026-08-12T09:00:00Z')))).toBe('3–9 Aug 2026');
  });

  it('names both months when the week straddles them', () => {
    // Week of Mon 2026-08-31 → Sun 2026-09-06.
    expect(formatWeekRange(closedWeek(new Date('2026-09-09T09:00:00Z')))).toBe(
      '31 Aug – 6 Sep 2026',
    );
  });

  it('names both years when the week straddles new year', () => {
    // Week of Mon 2026-12-28 → Sun 2027-01-03.
    expect(formatWeekRange(closedWeek(new Date('2027-01-06T09:00:00Z')))).toBe(
      '28 Dec 2026 – 3 Jan 2027',
    );
  });
});
