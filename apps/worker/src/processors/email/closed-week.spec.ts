import { describe, expect, it } from 'vitest';
import { dayOf, dayStartInstant, weekStartDay } from '@timetrack/contracts';
import { closedWeek, formatWeekRange } from './closed-week.js';

const iso = (d: Date) => d.toISOString();

// Every expectation below is an APP_TIMEZONE (Asia/Dhaka, UTC+6) Monday 00:00, i.e. Sunday
// 18:00 UTC — the instant `timesheet-generate.ts` writes as TimesheetApproval.periodStart.

describe('closedWeek', () => {
  it('reports the previous week, never the one in progress', () => {
    const week = closedWeek(new Date('2026-08-12T09:00:00Z')); // Wednesday
    expect(iso(week.periodStart)).toBe('2026-08-02T18:00:00.000Z');
    expect(iso(week.periodEnd)).toBe('2026-08-09T18:00:00.000Z');
  });

  it('still reports the previous week when it runs early Monday morning', () => {
    // The scheduled case: 08:00 UTC Monday is 14:00 in Dhaka, hours into a brand-new week.
    const week = closedWeek(new Date('2026-08-10T08:00:00Z'));
    expect(iso(week.periodStart)).toBe('2026-08-02T18:00:00.000Z');
    expect(iso(week.periodEnd)).toBe('2026-08-09T18:00:00.000Z');
  });

  it('rolls over at Monday 00:00 in the app timezone, not at UTC midnight', () => {
    // 18:30 UTC Sunday is 00:30 Monday 10 Aug in Dhaka — the week of 3–9 Aug has closed.
    const justAfter = closedWeek(new Date('2026-08-09T18:30:00Z'));
    expect(iso(justAfter.periodStart)).toBe('2026-08-02T18:00:00.000Z');
    expect(iso(justAfter.periodEnd)).toBe('2026-08-09T18:00:00.000Z');

    // One second before Dhaka midnight it is still Sunday 9 Aug: 3–9 Aug is in progress.
    const justBefore = closedWeek(new Date('2026-08-09T17:59:59Z'));
    expect(iso(justBefore.periodStart)).toBe('2026-07-26T18:00:00.000Z');
    expect(iso(justBefore.periodEnd)).toBe('2026-08-02T18:00:00.000Z');
  });

  it('is the same instant the timesheet generator writes as periodStart', () => {
    // The weekly summary matches PENDING approvals by exact equality on periodStart.
    const now = new Date('2026-08-10T08:00:00Z');
    const lastWeekDay = dayOf(new Date(now.getTime() - 7 * 86_400_000));
    expect(iso(closedWeek(now).periodStart)).toBe(iso(dayStartInstant(weekStartDay(lastWeekDay))));
  });

  it('spans exactly seven days, half-open', () => {
    const week = closedWeek(new Date('2026-01-01T00:00:00Z'));
    const days = (week.periodEnd.getTime() - week.periodStart.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });
});

describe('formatWeekRange', () => {
  it('collapses a single-month week and excludes the exclusive end day', () => {
    // periodEnd is Monday the 10th (Dhaka); the week's last day is Sunday the 9th.
    expect(formatWeekRange(closedWeek(new Date('2026-08-12T09:00:00Z')))).toBe('3–9 Aug 2026');
  });

  it('labels the local dates even though the instants fall on the previous UTC day', () => {
    // periodStart is 2026-08-02T18:00Z — a Sunday in UTC, but Monday 3 Aug in Dhaka.
    const week = closedWeek(new Date('2026-08-09T18:30:00Z'));
    expect(formatWeekRange(week)).toBe('3–9 Aug 2026');
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
