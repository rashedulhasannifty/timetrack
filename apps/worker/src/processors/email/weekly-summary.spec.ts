import { describe, expect, it } from 'vitest';
import { closedWeek } from './closed-week.js';
import { renderWeeklySummaryEmail, type SummaryMember } from './weekly-summary.js';
import { PRODUCT_NAME } from './render';

const week = closedWeek(new Date('2026-08-10T08:00:00Z')); // reports 3–9 Aug 2026

const members: SummaryMember[] = [
  { userId: 'u1', name: 'Ada Lovelace', trackedSeconds: 8 * 3600 + 30 * 60, activityPct: 74 },
  { userId: 'u2', name: 'Grace Hopper', trackedSeconds: 3600, activityPct: null },
  { userId: 'u3', name: 'Alan Turing', trackedSeconds: 0, activityPct: null },
];

const base = {
  recipientName: 'Mgr',
  teamName: 'Engineering',
  week,
  members,
  pendingApprovals: 2,
  appUrl: 'https://timer.niftyitsolution.com',
};

describe('renderWeeklySummaryEmail', () => {
  it('names the team and the closed week in the subject', () => {
    expect(renderWeeklySummaryEmail(base).subject).toBe(
      `${PRODUCT_NAME} weekly summary — Engineering, 3–9 Aug 2026`,
    );
  });

  it('totals the team and counts only the people who tracked something', () => {
    const mail = renderWeeklySummaryEmail(base);
    // 8h30m + 1h + 0 = 9h30m, tracked by 2 of 3.
    expect(mail.text).toContain('9h 30m across 2 of 3 people');
    expect(mail.html).toContain('9h 30m');
  });

  it('lists a zero-hour member rather than dropping them', () => {
    const mail = renderWeeklySummaryEmail(base);
    expect(mail.text).toContain('Alan Turing — 0h 0m');
    expect(mail.html).toContain('Alan Turing');
  });

  it('renders missing activity data as — , not 0%', () => {
    const mail = renderWeeklySummaryEmail(base);
    expect(mail.text).toContain('Grace Hopper — 1h 0m, activity —');
    expect(mail.text).toContain('Ada Lovelace — 8h 30m, activity 74%');
    expect(mail.text).not.toContain('activity 0%');
  });

  it('links to the approvals queue when timesheets are waiting', () => {
    const mail = renderWeeklySummaryEmail(base);
    expect(mail.text).toContain('2 timesheets from this week are waiting for your review.');
    expect(mail.text).toContain('https://timer.niftyitsolution.com/approvals');
    expect(mail.html).toContain('href="https://timer.niftyitsolution.com/approvals"');
  });

  it('says so plainly, with no link, when nothing is waiting', () => {
    const mail = renderWeeklySummaryEmail({ ...base, pendingApprovals: 0 });
    expect(mail.text).toContain('No timesheets are waiting for your review.');
    expect(mail.html).not.toContain('/approvals');
  });

  it('agrees with English on a single pending timesheet', () => {
    const mail = renderWeeklySummaryEmail({ ...base, pendingApprovals: 1 });
    expect(mail.text).toContain('1 timesheet from this week is waiting');
  });

  it('normalises a trailing slash on APP_URL rather than emitting //', () => {
    const mail = renderWeeklySummaryEmail({ ...base, appUrl: 'https://x.test/' });
    expect(mail.html).toContain('href="https://x.test/approvals"');
    expect(mail.html).not.toContain('//approvals');
  });

  it('escapes HTML in member and team names', () => {
    const mail = renderWeeklySummaryEmail({
      ...base,
      teamName: '<script>alert(1)</script>',
      members: [{ userId: 'u1', name: '<img onerror=x>', trackedSeconds: 60, activityPct: 10 }],
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img onerror');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&lt;img onerror=x&gt;');
    // The text body is not HTML, so it carries the names verbatim.
    expect(mail.text).toContain('<img onerror=x>');
  });
});
