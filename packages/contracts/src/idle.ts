import { z } from 'zod';

/**
 * PRD §6.1 / §6.4 — on resume from idle the client asks "away for X min — keep or
 * discard?" (discard is the default). The resolved event syncs here; DISCARDED means
 * the overlapping auto-tracked time is dropped.
 */
export const ResolvedAction = z.enum(['KEPT', 'DISCARDED', 'UNRESOLVED']);

export const IdleEventSchema = z.object({
  id: z.uuid(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
  resolvedAction: ResolvedAction,
});

/** The ingest response: the stored event's identity + how it resolved. */
export const IdleEventResultSchema = z.object({
  id: z.uuid(),
  resolvedAction: ResolvedAction,
});

/** Self-view / manager read window. Read rows reuse IdleEventSchema. */
export const ListIdleEventsQuerySchema = z.object({
  userId: z.uuid().optional(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

export type ResolvedAction = z.infer<typeof ResolvedAction>;
export type IdleEvent = z.infer<typeof IdleEventSchema>;
export type IdleEventResult = z.infer<typeof IdleEventResultSchema>;
export type ListIdleEventsQuery = z.infer<typeof ListIdleEventsQuerySchema>;
