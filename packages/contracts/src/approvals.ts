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
  /**
   * The longest single entry in the period, in seconds — but ONLY when it is long enough to be
   * worth a second look. `null` is the normal case and means "nothing here is unusual".
   *
   * Derived per request from the entries themselves; nothing is stored, and no team setting
   * configures it. The threshold lives in one place on the server (`LONG_ENTRY_SECONDS`), so the
   * dashboard's rule is simply "not null → say so" and the two can never disagree about what
   * counts as long.
   *
   * This exists because a timer someone forgot to stop is invisible in a weekly total — 47 hours
   * across a week looks like a busy week until you notice one entry is 11 of them. Approving
   * pins `totalSeconds`, so this is the last moment the inflated figure can be caught.
   */
  longEntrySeconds: z.number().int().positive().nullable(),
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
