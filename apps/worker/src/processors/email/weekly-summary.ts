import type { PrismaClient } from '@timetrack/db';
import { formatWeekRange, type ClosedWeek } from './closed-week.js';
import { appLink, escapeHtml, formatHours, htmlDocument, type RenderedMessage } from './render.js';
import { trackedSecondsByUser, weightedActivityPctByUser } from './week-hours.js';

/**
 * PRD §6.7 — the weekly manager summary: one email per team, to that team's MANAGERs, covering
 * the last closed ISO week.
 *
 * Recipients are `role = 'MANAGER'` within the team. `Team` has no manager foreign key, so
 * team membership + role IS the manager relation — the same rule ResourceAccessService applies
 * for manager-of-team authorization in the API.
 */

export interface SummaryMember {
  userId: string;
  name: string;
  trackedSeconds: number;
  /** null = no rolled-up activity for the week. NOT the same fact as 0%, so it renders as '—'. */
  activityPct: number | null;
}

export interface SummaryRecipient {
  name: string;
  email: string;
}

export interface TeamWeeklySummary {
  teamId: string;
  teamName: string;
  /** Active MANAGERs of the team. Empty is a real state — the caller reports it, not this. */
  recipients: SummaryRecipient[];
  /** Every active member, INCLUDING the managers themselves and anyone who tracked nothing. */
  members: SummaryMember[];
  /** PENDING timesheet approvals for this week awaiting someone on this team. */
  pendingApprovals: number;
}

/**
 * Build one summary per team that has at least one active member. A member who tracked nothing
 * is still listed — an absence is exactly what a manager needs to see, and dropping the row
 * would make a quiet week indistinguishable from a small team.
 */
export async function collectWeeklySummaries(
  prisma: PrismaClient,
  week: ClosedWeek,
): Promise<TeamWeeklySummary[]> {
  const people = await prisma.user.findMany({
    where: { deactivatedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teamId: true,
      team: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });
  if (people.length === 0) return [];

  const userIds = people.map((p) => p.id);
  const [tracked, activity, pendingRows] = await Promise.all([
    trackedSecondsByUser(prisma, userIds, week.periodStart, week.periodEnd),
    weightedActivityPctByUser(prisma, userIds, week.periodStart, week.periodEnd),
    // Counted in JS rather than a GROUP BY on the joined team: one PENDING row per user per
    // week bounds this to the active headcount, and it keeps the enum out of raw SQL.
    prisma.timesheetApproval.findMany({
      where: { periodStart: week.periodStart, status: 'PENDING' },
      select: { user: { select: { teamId: true } } },
    }),
  ]);

  const pendingByTeam = new Map<string, number>();
  for (const row of pendingRows) {
    pendingByTeam.set(row.user.teamId, (pendingByTeam.get(row.user.teamId) ?? 0) + 1);
  }

  const byTeam = new Map<string, TeamWeeklySummary>();
  for (const person of people) {
    let summary = byTeam.get(person.teamId);
    if (!summary) {
      summary = {
        teamId: person.teamId,
        teamName: person.team.name,
        recipients: [],
        members: [],
        pendingApprovals: pendingByTeam.get(person.teamId) ?? 0,
      };
      byTeam.set(person.teamId, summary);
    }
    summary.members.push({
      userId: person.id,
      name: person.name,
      trackedSeconds: tracked.get(person.id) ?? 0,
      activityPct: activity.get(person.id) ?? null,
    });
    if (person.role === 'MANAGER') {
      summary.recipients.push({ name: person.name, email: person.email });
    }
  }

  for (const summary of byTeam.values()) {
    // Busiest first; ties by name so two identical weeks render in a stable order.
    summary.members.sort(
      (a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name),
    );
  }
  return [...byTeam.values()];
}

export interface WeeklySummaryInput {
  recipientName: string;
  teamName: string;
  week: ClosedWeek;
  members: SummaryMember[];
  pendingApprovals: number;
  /** The dashboard's public origin (APP_URL). */
  appUrl: string;
}

const pct = (value: number | null): string => (value === null ? '—' : `${value}%`);

export function renderWeeklySummaryEmail(input: WeeklySummaryInput): RenderedMessage {
  const range = formatWeekRange(input.week);
  const teamUrl = appLink(input.appUrl, '/');
  const approvalsUrl = appLink(input.appUrl, '/approvals');
  const totalSeconds = input.members.reduce((sum, m) => sum + m.trackedSeconds, 0);
  const trackedCount = input.members.filter((m) => m.trackedSeconds > 0).length;
  const subject = `TimeTrack weekly summary — ${input.teamName}, ${range}`;

  const approvalsLine =
    input.pendingApprovals === 0
      ? 'No timesheets are waiting for your review.'
      : `${input.pendingApprovals} timesheet${input.pendingApprovals === 1 ? '' : 's'} from this week ${input.pendingApprovals === 1 ? 'is' : 'are'} waiting for your review.`;

  const text = [
    `Hi ${input.recipientName},`,
    '',
    `Here is how ${input.teamName} tracked during ${range}.`,
    '',
    `Team total: ${formatHours(totalSeconds)} across ${trackedCount} of ${input.members.length} people.`,
    '',
    ...input.members.map(
      (m) => `  ${m.name} — ${formatHours(m.trackedSeconds)}, activity ${pct(m.activityPct)}`,
    ),
    '',
    approvalsLine,
    input.pendingApprovals === 0 ? '' : approvalsUrl,
    '',
    `Team overview: ${teamUrl}`,
    '',
    'Activity is the share of tracked time with keyboard or mouse input, weighted by how long',
    'each day was tracked. "—" means no activity was recorded for that person this week.',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  const rows = input.members
    .map(
      (m) =>
        `<tr><td style="padding:6px 12px 6px 0">${escapeHtml(m.name)}</td>` +
        `<td style="padding:6px 12px 6px 0;text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(formatHours(m.trackedSeconds))}</td>` +
        `<td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;color:#555">${escapeHtml(pct(m.activityPct))}</td></tr>`,
    )
    .join('');

  const html = htmlDocument([
    `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
    `<p>Here is how <strong>${escapeHtml(input.teamName)}</strong> tracked during ${escapeHtml(range)}.</p>`,
    `<p style="font-size:15px"><strong>${escapeHtml(formatHours(totalSeconds))}</strong> across ${trackedCount} of ${input.members.length} people.</p>`,
    '<table style="border-collapse:collapse;font-size:14px">',
    '<thead><tr style="text-align:left;color:#555;font-size:12px;text-transform:uppercase">',
    '<th style="padding:0 12px 4px 0">Member</th>',
    '<th style="padding:0 12px 4px 0;text-align:right">Tracked</th>',
    '<th style="padding:0 0 4px;text-align:right">Activity</th>',
    '</tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    input.pendingApprovals === 0
      ? `<p>${escapeHtml(approvalsLine)}</p>`
      : `<p>${escapeHtml(approvalsLine)} <a href="${escapeHtml(approvalsUrl)}">Review timesheets</a></p>`,
    `<p><a href="${escapeHtml(teamUrl)}">Open the team overview</a></p>`,
    '<p style="font-size:13px;color:#555">Activity is the share of tracked time with keyboard or mouse input, weighted by how long each day was tracked. &ldquo;—&rdquo; means no activity was recorded for that person this week.</p>',
  ]);

  return { subject, text, html };
}
