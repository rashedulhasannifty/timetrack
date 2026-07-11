import { z } from 'zod';
import { Category } from './enums.js';

export const ActivitySampleSchema = z.object({
  id: z.uuid(),
  timestamp: z.iso.datetime(),
  appName: z.string().max(200),
  // PRD §13 — truncated to 120 chars, redacted in logs, nullable if the team opts out.
  windowTitle: z.string().max(120).nullable(),
  activityPct: z.number().int().min(0).max(100),
  category: Category.default('NEUTRAL'),
});

export const ActivityBatchSchema = z.object({
  samples: z.array(ActivitySampleSchema).min(1).max(500),
});

/** Idempotent ingest: `accepted` counts rows actually inserted (duplicates skipped). */
export const ActivityIngestResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export type ActivitySample = z.infer<typeof ActivitySampleSchema>;
export type ActivityBatch = z.infer<typeof ActivityBatchSchema>;
export type ActivityIngestResult = z.infer<typeof ActivityIngestResultSchema>;
