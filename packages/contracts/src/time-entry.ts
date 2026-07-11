import { z } from 'zod';
import { EntrySource } from './enums.js';

/**
 * PRD §7.5 — `id` is minted on the client (UUIDv7) and used as the idempotency key.
 * A retried offline batch upserts on this id, so it is a no-op rather than a duplicate.
 */
export const CreateTimeEntrySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime().nullable(),
  source: EntrySource,
  note: z.string().max(2000).optional(),
});

export const UpdateTimeEntrySchema = CreateTimeEntrySchema.partial().omit({ id: true });

export const TimeEntrySchema = CreateTimeEntrySchema.extend({
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

export type CreateTimeEntry = z.infer<typeof CreateTimeEntrySchema>;
export type UpdateTimeEntry = z.infer<typeof UpdateTimeEntrySchema>;
export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type ListTimeEntriesQuery = z.infer<typeof ListTimeEntriesQuerySchema>;
