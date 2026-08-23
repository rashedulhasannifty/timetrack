import { describe, expect, it } from 'vitest';
import { closedWeek } from './closed-week.js';
import { renderMissingTimesheetEmail } from './missing-timesheet.js';
import { PRODUCT_NAME } from './render';

const week = closedWeek(new Date('2026-08-10T09:00:00Z')); // reports 3–9 Aug 2026

const base = {
  name: 'Ada Lovelace',
  week,
  trackedSeconds: 4 * 3600,
  thresholdHours: 20,
  appUrl: 'https://timer.niftyitsolution.com',
};

describe('renderMissingTimesheetEmail', () => {
  it('names the closed week in the subject', () => {
    expect(renderMissingTimesheetEmail(base).subject).toBe(
      `Your ${PRODUCT_NAME} hours for 3–9 Aug 2026 look incomplete`,
    );
  });

  it('states the hours found and the threshold they fell under', () => {
    const mail = renderMissingTimesheetEmail(base);
    expect(mail.text).toContain(`${PRODUCT_NAME} has 4h 0m for you for 3–9 Aug 2026`);
    expect(mail.text).toContain('20-hour mark');
    expect(mail.html).toContain('4h 0m');
  });

  it('does not claim an amount when nothing was tracked at all', () => {
    const mail = renderMissingTimesheetEmail({ ...base, trackedSeconds: 0 });
    expect(mail.text).toContain(`No tracked time has reached ${PRODUCT_NAME} for 3–9 Aug 2026.`);
    expect(mail.text).not.toContain('0h 0m');
  });

  it('points the employee at their own week, not a manager view', () => {
    const mail = renderMissingTimesheetEmail(base);
    expect(mail.text).toContain('https://timer.niftyitsolution.com/me');
    expect(mail.html).toContain('href="https://timer.niftyitsolution.com/me"');
    expect(mail.html).not.toContain('/approvals');
  });

  it('normalises a trailing slash on APP_URL rather than emitting //', () => {
    const mail = renderMissingTimesheetEmail({ ...base, appUrl: 'https://x.test/' });
    expect(mail.html).toContain('href="https://x.test/me"');
  });

  it('explains the running-timer case, since only finished entries are uploaded', () => {
    const mail = renderMissingTimesheetEmail(base);
    expect(mail.text).toContain('Only finished entries are uploaded');
    expect(mail.html).toContain('Only finished entries are uploaded');
  });

  it('says it is automated, so it does not read as a message from a manager', () => {
    const mail = renderMissingTimesheetEmail(base);
    expect(mail.text).toContain('automated reminder from your team settings');
    expect(mail.html).toContain('automated reminder from your team settings');
  });

  it('escapes HTML in the employee name', () => {
    const mail = renderMissingTimesheetEmail({ ...base, name: '<script>alert(1)</script>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
