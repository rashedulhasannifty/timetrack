import { z } from 'zod';
import { EntrySource } from './enums.js';

/**
 * PRD §7.5 — `id` is minted on the client (UUIDv7) and used as the idempotency key.
 * A retried offline batch upserts on this id, so it is a no-op rather than a duplicate.
 */
const timeEntryShape = {
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime().nullable(),
  source: EntrySource,
  note: z.string().max(2000).optional(),
};

/**
 * The bare object. Every exported schema derives from this one so that `.partial()`/`.extend()`
 * stay available — the temporal check is added per-schema, never baked in here.
 */
const TimeEntryBase = z.object(timeEntryShape);

/**
 * An entry may be zero-length but never negative.
 *
 * Zero is deliberate and load-bearing: the client's interrupted-time recovery writes
 * `end == start` on Discard to release the one-running-per-user index slot
 * (`LiveSpanRecovery.swift`), so `>` here would reject a legitimate close and strand the row
 * open forever. Only an inverted entry is refused.
 */
const END_NOT_BEFORE_START = 'endTime must not be before startTime';

function isInverted(startTime: string, endTime: string | null | undefined): boolean {
  if (endTime === null || endTime === undefined) return false;
  return Date.parse(endTime) < Date.parse(startTime);
}

/**
 * Added with `.check()`, NOT `.refine()`: refine returns a wrapper that is no longer a
 * `ZodObject`, and `ZodValidationPipe` only applies strict mode (the mass-assignment guard)
 * to `ZodObject`. Refining here would silently switch strict parsing off for this body.
 */
export const CreateTimeEntrySchema = TimeEntryBase.check((ctx) => {
  if (isInverted(ctx.value.startTime, ctx.value.endTime)) {
    ctx.issues.push({
      code: 'custom',
      message: END_NOT_BEFORE_START,
      input: ctx.value,
      path: ['endTime'],
    });
  }
});

/**
 * A patch carries only the fields it changes, so this can check the pair only when the patch
 * supplies BOTH. A patch that moves one edge against a stored one is checked in
 * `TimeEntriesService.edit`, against the merged entry — the schema cannot see the stored row.
 */
export const UpdateTimeEntrySchema = TimeEntryBase.partial()
  .omit({ id: true })
  .check((ctx) => {
    const { startTime, endTime } = ctx.value;
    if (startTime !== undefined && isInverted(startTime, endTime)) {
      ctx.issues.push({
        code: 'custom',
        message: END_NOT_BEFORE_START,
        input: ctx.value,
        path: ['endTime'],
      });
    }
  });

export const TimeEntrySchema = TimeEntryBase.extend({
  userId: z.uuid(),
  editedById: z.uuid().nullable(),
  editedAt: z.iso.datetime().nullable(),
});

export const ListTimeEntriesQuerySchema = z.object({
  userId: z.uuid().optional(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid().optional(),
});

export { END_NOT_BEFORE_START, isInverted };

export type CreateTimeEntry = z.infer<typeof CreateTimeEntrySchema>;
export type UpdateTimeEntry = z.infer<typeof UpdateTimeEntrySchema>;
export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type ListTimeEntriesQuery = z.infer<typeof ListTimeEntriesQuerySchema>;
