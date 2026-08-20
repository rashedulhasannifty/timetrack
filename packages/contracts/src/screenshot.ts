import { z } from 'zod';
import { ShotStatus } from './enums.js';

/**
 * PRD §6.2 / §7.4 — the client POSTs a multipart image; the API streams it to MinIO,
 * writes a row with status PENDING, and a worker marks it READY. Dashboard reads go
 * through short-lived presigned URLs (never a public bucket).
 */
export const ScreenshotSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  timestamp: z.iso.datetime(),
  storageKey: z.string(),
  thumbnailKey: z.string().nullable(),
  blurred: z.boolean(),
  status: ShotStatus,
  redactedReason: z.string().nullable(),
  /**
   * Shared by every display captured in the same tick, so a multi-monitor desk reads as one
   * group. Null on captures taken before multi-display support — treat those as a group of one,
   * which is exactly what they were.
   *
   * All three grouping fields `.default(null)` rather than being plain required-nullable. The
   * dashboard parses API responses through this schema, so an API that has not been deployed yet
   * would otherwise fail the parse outright instead of degrading to ungrouped tiles. The INFERRED
   * type stays required, so a producer that forgets a field is still a compile error.
   */
  captureGroupId: z.string().nullable().default(null),
  /** Position in the group: 0 is the main display, then by display id. Null on legacy rows. */
  displayIndex: z.number().int().nullable().default(null),
  /** Displays the client tried to capture that tick — fewer rows than this means a partial capture. */
  displayCount: z.number().int().nullable().default(null),
  /** Presigned GET URL (5 min TTL). Present only on read responses. */
  url: z.url().optional(),
  /** Presigned full-res GET URL (5 min TTL). Present only on READY reads with a raw object. */
  fullUrl: z.url().optional(),
});

/**
 * PRD §6.2 — an employee flags/redacts their own screenshot with a reason.
 * The image is marked REDACTED and surfaced to the manager as such — never silently removed.
 */
export const RedactScreenshotSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const ListScreenshotsQuerySchema = z.object({
  userId: z.uuid().optional(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

/**
 * PRD §7.4 — multipart upload metadata. The image itself is the file part, not in this
 * schema. `timestamp` is client-supplied: it is half the composite PK [id, timestamp] and
 * drives monthly partitioning, so a retried upload must land on the same partition + PK.
 */
export const UploadScreenshotMetaSchema = z.object({
  id: z.uuid(), // client-minted UUIDv7 → idempotency key
  timestamp: z.iso.datetime(), // capture time — also the partition key
  /**
   * Multi-display grouping. All three are OPTIONAL: a client built before multi-display capture
   * sends neither, and /v1 must keep accepting it (a shipped Mac client cannot be rolled back).
   * Absent → the API stores nulls and the shot reads back as a group of one.
   *
   * These arrive as multipart TEXT fields, so the numerics are strings on the wire and are
   * coerced here. `.optional()` wraps the coercion, so an absent field stays undefined rather
   * than coercing to NaN.
   */
  captureGroupId: z.uuid().optional(),
  displayIndex: z.coerce.number().int().min(0).max(15).optional(),
  displayCount: z.coerce.number().int().min(1).max(16).optional(),
});

export type Screenshot = z.infer<typeof ScreenshotSchema>;
export type RedactScreenshot = z.infer<typeof RedactScreenshotSchema>;
export type ListScreenshotsQuery = z.infer<typeof ListScreenshotsQuerySchema>;
export type UploadScreenshotMeta = z.infer<typeof UploadScreenshotMetaSchema>;
