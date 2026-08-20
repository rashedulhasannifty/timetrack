import { z } from 'zod';
import { Category } from './enums.js';

export const ActivitySampleSchema = z.object({
  id: z.uuid(),
  timestamp: z.iso.datetime(),
  appName: z.string().max(200),
  // Stable macOS bundle identifier (e.g. 'com.microsoft.VSCode'), for rename-proof matching.
  // Optional + nullable and additive to /v1: the shipped client omits it; a newer client sends it
  // or null. Deploy the API (which accepts it) BEFORE releasing a client that sends it.
  bundleId: z.string().max(255).nullable().optional(),
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

/** Self-view / manager read window. Bounded by from/to (a natural query cap). */
export const ListActivityQuerySchema = z.object({
  userId: z.uuid().optional(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

export type ActivitySample = z.infer<typeof ActivitySampleSchema>;
export type ActivityBatch = z.infer<typeof ActivityBatchSchema>;
export type ActivityIngestResult = z.infer<typeof ActivityIngestResultSchema>;
export type ListActivityQuery = z.infer<typeof ListActivityQuerySchema>;

/**
 * PRD §6.3 — the worker rolls each user's samples into one row per Dhaka day (APP_TIMEZONE,
 * see `time.ts`), NOT per UTC day. Each sample
 * represents one fixed sampling interval, so minutes = count × interval / 60.
 * The client (Swift, 2.3b) mirrors this constant by convention; it cannot import this file.
 */
export const ACTIVITY_SAMPLE_INTERVAL_SECONDS = 60;

/** Per-day activity rollup (worker output; dashboard read). Minutes are integers. */
export const ActivityDailySummarySchema = z.object({
  userId: z.uuid(),
  day: z.iso.date(), // 'YYYY-MM-DD'
  avgActivityPct: z.number().int().min(0).max(100),
  activeMinutes: z.number().int().nonnegative(),
  // Minutes per app / per category. Keys are app names / Category values; a partial map
  // (absent keys omitted). string→int keeps values validated without Zod's full-enum-key rule.
  byApp: z.record(z.string(), z.number().int().nonnegative()),
  byCategory: z.record(z.string(), z.number().int().nonnegative()),
});

/** Self-view / manager read window, bounded by from/to dates. */
export const ListActivitySummaryQuerySchema = z.object({
  userId: z.uuid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});

export type ActivityDailySummary = z.infer<typeof ActivityDailySummarySchema>;
export type ListActivitySummaryQuery = z.infer<typeof ListActivitySummaryQuerySchema>;
