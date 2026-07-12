import { z } from 'zod';

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
  date: z.iso.date().optional(), // YYYY-MM-DD; absent → server's current UTC date
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
