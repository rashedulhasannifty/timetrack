import { z } from 'zod';

export const ApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'FLAGGED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const TimesheetApprovalSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  status: ApprovalStatusSchema,
  trackedSeconds: z.number().int().nonnegative(), // LIVE hours for the period (list-time)
  totalSeconds: z.number().int().nonnegative().nullable(), // SNAPSHOT pinned at decision
  reviewerId: z.uuid().nullable(),
  note: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type TimesheetApproval = z.infer<typeof TimesheetApprovalSchema>;

export const DecisionSchema = z.object({
  status: z.enum(['APPROVED', 'FLAGGED']), // PENDING is not a decision
  note: z.string().max(2000).optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ApprovalListQuerySchema = z.object({
  status: ApprovalStatusSchema.optional(),
  teamId: z.uuid().optional(),
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;
