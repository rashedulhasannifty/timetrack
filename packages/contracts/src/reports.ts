import { z } from 'zod';
import { Category } from './enums.js';

export const ReportRangeQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  userId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  teamId: z.uuid().optional(),
});

export const TeamSummaryRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
  activityPct: z.number().int().min(0).max(100),
});

export const TeamSummarySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(TeamSummaryRowSchema),
});

export type ReportRangeQuery = z.infer<typeof ReportRangeQuerySchema>;
export type TeamSummaryRow = z.infer<typeof TeamSummaryRowSchema>;
export type TeamSummary = z.infer<typeof TeamSummarySchema>;

export const TeamOverviewQuerySchema = z.object({
  date: z.iso.date().optional(), // YYYY-MM-DD Dhaka day; absent → the server's current Dhaka day
});

export const TeamOverviewRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  tracking: z.boolean(),
  trackedSecondsToday: z.number().int().nonnegative(),
});

export const TeamOverviewSchema = z.object({
  date: z.iso.date(),
  rows: z.array(TeamOverviewRowSchema),
});

export type TeamOverviewQuery = z.infer<typeof TeamOverviewQuerySchema>;
export type TeamOverviewRow = z.infer<typeof TeamOverviewRowSchema>;
export type TeamOverview = z.infer<typeof TeamOverviewSchema>;

/**
 * The signed-in person's OWN tracked totals, for the Mac app's dropdown. Always self-scoped —
 * there is no userId parameter, so no one can read anyone else's totals through it.
 *
 * Seconds, not minutes: the client renders "8h 12m" and rounding twice (here and again in the
 * UI) loses a minute at the boundary for no benefit.
 *
 * `weekSeconds` CAN exceed `monthSeconds`. A Monday-start week straddling a month boundary —
 * Monday Aug 31 with today Sep 2 — puts two days of that week in the previous month. The
 * ranges overlap; they do not nest.
 */
export const SelfTotalsSchema = z.object({
  /** The Dhaka day the totals are anchored to. */
  day: z.iso.date(),
  /** Monday of the week containing `day`. Sent so the client labels the row without doing date math. */
  weekStart: z.iso.date(),
  /** First of the month containing `day`. */
  monthStart: z.iso.date(),
  todaySeconds: z.number().int().nonnegative(),
  weekSeconds: z.number().int().nonnegative(),
  monthSeconds: z.number().int().nonnegative(),
});

export type SelfTotals = z.infer<typeof SelfTotalsSchema>;

export const ProjectSummaryRowSchema = z.object({
  projectId: z.uuid().nullable(), // null → the "No project" bucket
  name: z.string(), // project name, or "No project"
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectSummarySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(ProjectSummaryRowSchema),
});

export type ProjectSummaryRow = z.infer<typeof ProjectSummaryRowSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const TeamTrendDaySchema = z.object({
  day: z.iso.date(),
  trackedSeconds: z.number().int().nonnegative(),
  productiveSeconds: z.number().int().nonnegative(),
  neutralSeconds: z.number().int().nonnegative(),
  unproductiveSeconds: z.number().int().nonnegative(),
});
export const TeamTrendsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  days: z.array(TeamTrendDaySchema),
});
export type TeamTrendDay = z.infer<typeof TeamTrendDaySchema>;
export type TeamTrends = z.infer<typeof TeamTrendsSchema>;

export const TeamActivityRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  activeMinutes: z.number().int().nonnegative(),
  productivePct: z.number().int().min(0).max(100),
  neutralPct: z.number().int().min(0).max(100),
  unproductivePct: z.number().int().min(0).max(100),
  idleMinutes: z.number().int().nonnegative(),
  idlePct: z.number().int().min(0).max(100),
});
export const TeamActivitySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(TeamActivityRowSchema),
});
export type TeamActivityRow = z.infer<typeof TeamActivityRowSchema>;
export type TeamActivity = z.infer<typeof TeamActivitySchema>;

export const TeamAppUsageRowSchema = z.object({
  appName: z.string(),
  seconds: z.number().int().nonnegative(),
  category: Category,
});
export const TeamAppUsageSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(TeamAppUsageRowSchema),
});
export type TeamAppUsageRow = z.infer<typeof TeamAppUsageRowSchema>;
export type TeamAppUsage = z.infer<typeof TeamAppUsageSchema>;

// app-usage takes an extra ?limit; query params arrive as strings, so coerce.
export const AppUsageQuerySchema = ReportRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AppUsageQuery = z.infer<typeof AppUsageQuerySchema>;
