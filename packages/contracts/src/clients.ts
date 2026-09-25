import { z } from 'zod';
import { Platform } from './enums.js';

/**
 * A desktop app version as the app reports it: dotted numbers only, e.g. "0.6.1". Any
 * pre-release or build suffix is dropped by the app before sending, so the server never has
 * to guess how "0.7.0-pilot" orders against "0.7.0".
 */
export const ClientVersion = z
  .string()
  .max(32)
  .regex(/^\d{1,4}(\.\d{1,4}){0,3}$/);

/**
 * The identity headers the desktop apps send on /auth/login and /auth/refresh. Node lowercases
 * header names, so the keys are lowercase here. Both are optional on the wire — the dashboard's
 * own server calls send neither, and older apps predate them — so the API parses these
 * leniently and simply records nothing when they are missing or malformed.
 */
export const ClientHeadersSchema = z.object({
  'x-client-platform': Platform,
  'x-client-version': ClientVersion,
});

/** Response element of GET /v1/clients: the version a user's app last reported, per platform. */
export const ClientInstallSchema = z.object({
  userId: z.uuid(),
  platform: Platform,
  version: ClientVersion,
  lastSeenAt: z.iso.datetime(),
});

export type ClientHeaders = z.infer<typeof ClientHeadersSchema>;
export type ClientInstall = z.infer<typeof ClientInstallSchema>;
