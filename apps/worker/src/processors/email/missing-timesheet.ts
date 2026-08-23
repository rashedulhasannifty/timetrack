import { PRODUCT_NAME } from './render';
import { TeamSettingsSchema } from '@timetrack/contracts';
import type { PrismaClient } from '@timetrack/db';
import { formatWeekRange, type ClosedWeek } from './closed-week.js';
import { appLink, escapeHtml, formatHours, htmlDocument, type RenderedMessage } from './render.js';
import { trackedSecondsByUser } from './week-hours.js';

/**
 * PRD §6.7 — the missing-timesheet reminder: one email to an EMPLOYEE whose tracked hours for
 * the last closed ISO week came in under their team's `timesheetReminderHours`.
 *
 * Three deliberate narrowings, each cheap to widen if the product wants it:
 *  - OFF unless an admin sets a threshold (default 0). Employee-facing email is opt-in.
 *  - `role = 'EMPLOYEE'` only. Managers and admins track time too, but they are the people who
 *    ACT on this report; nagging the reviewer is not what was asked for.
 *  - Only people who were on the roster before the week began. A Wednesday start cannot reach a
 *    full-week threshold, so reminding them would be a guaranteed false positive.
 */

export interface ReminderTarget {
  userId: string;
  name: string;
  email: string;
  trackedSeconds: number;
  /** The team's threshold, in hours — repeated in the email so the number is never a mystery. */
  thresholdHours: number;
}

export async function collectMissingTimesheets(
  prisma: PrismaClient,
  week: ClosedWeek,
  freshnessSeconds: number,
): Promise<ReminderTarget[]> {
  const teams = await prisma.team.findMany({ select: { id: true, settings: true } });

  // Defaults live in TeamSettingsSchema, so a legacy/partial settings row resolves to 0 (off)
  // here exactly as it does everywhere else that reads the policy.
  const thresholdByTeam = new Map<string, number>();
  for (const team of teams) {
    const hours = TeamSettingsSchema.parse(team.settings ?? {}).timesheetReminderHours;
    if (hours > 0) thresholdByTeam.set(team.id, hours);
  }
  if (thresholdByTeam.size === 0) return [];

  const people = await prisma.user.findMany({
    where: {
      deactivatedAt: null,
      role: 'EMPLOYEE',
      teamId: { in: [...thresholdByTeam.keys()] },
      createdAt: { lt: week.periodStart },
    },
    select: { id: true, name: true, email: true, teamId: true },
    orderBy: { name: 'asc' },
  });
  if (people.length === 0) return [];

  const tracked = await trackedSecondsByUser(
    prisma,
    people.map((p) => p.id),
    week.periodStart,
    week.periodEnd,
    freshnessSeconds,
  );

  const targets: ReminderTarget[] = [];
  for (const person of people) {
    const thresholdHours = thresholdByTeam.get(person.teamId);
    if (thresholdHours === undefined) continue; // unreachable — the query filtered on these ids
    const trackedSeconds = tracked.get(person.id) ?? 0;
    if (trackedSeconds >= thresholdHours * 3600) continue;
    targets.push({
      userId: person.id,
      name: person.name,
      email: person.email,
      trackedSeconds,
      thresholdHours,
    });
  }
  return targets;
}

export interface MissingTimesheetInput {
  name: string;
  week: ClosedWeek;
  trackedSeconds: number;
  thresholdHours: number;
  /** The dashboard's public origin (APP_URL). */
  appUrl: string;
}

export function renderMissingTimesheetEmail(input: MissingTimesheetInput): RenderedMessage {
  const range = formatWeekRange(input.week);
  const myWeekUrl = appLink(input.appUrl, '/me');
  const tracked = formatHours(input.trackedSeconds);
  const subject = `Your ${PRODUCT_NAME} hours for ${range} look incomplete`;

  const opening =
    input.trackedSeconds === 0
      ? `No tracked time has reached ${PRODUCT_NAME} for ${range}.`
      : `${PRODUCT_NAME} has ${tracked} for you for ${range}, which is under your team's ${input.thresholdHours}-hour mark.`;

  const text = [
    `Hi ${input.name},`,
    '',
    opening,
    '',
    'If that looks wrong, the two usual causes are:',
    `  - The app has not synced yet. Open ${PRODUCT_NAME} and let it finish uploading.`,
    '  - A timer is still running. Only finished entries are uploaded, so stop the timer',
    '    to make that time count.',
    '',
    'Otherwise you can add or correct last week’s entries yourself:',
    myWeekUrl,
    '',
    'This is an automated reminder from your team settings, not a message from your manager.',
  ].join('\n');

  const html = htmlDocument([
    `<p>Hi ${escapeHtml(input.name)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    '<p>If that looks wrong, the two usual causes are:</p>',
    '<ul>',
    `<li>The app has not synced yet — open ${PRODUCT_NAME} and let it finish uploading.</li>`,
    '<li>A timer is still running. Only finished entries are uploaded, so stop the timer to make that time count.</li>',
    '</ul>',
    `<p>Otherwise you can add or correct last week&rsquo;s entries yourself:</p>`,
    `<p><a href="${escapeHtml(myWeekUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open my week</a></p>`,
    '<p style="font-size:13px;color:#555">This is an automated reminder from your team settings, not a message from your manager.</p>',
  ]);

  return { subject, text, html };
}
