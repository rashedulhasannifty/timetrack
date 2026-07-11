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

export type ResolvedAction = z.infer<typeof ResolvedAction>;
export type IdleEvent = z.infer<typeof IdleEventSchema>;
