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
});

export type Screenshot = z.infer<typeof ScreenshotSchema>;
export type RedactScreenshot = z.infer<typeof RedactScreenshotSchema>;
export type ListScreenshotsQuery = z.infer<typeof ListScreenshotsQuerySchema>;
export type UploadScreenshotMeta = z.infer<typeof UploadScreenshotMetaSchema>;
