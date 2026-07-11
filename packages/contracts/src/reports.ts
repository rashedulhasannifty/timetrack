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
