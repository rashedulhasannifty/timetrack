import { z } from 'zod';

export const Role = z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']);
export const EntrySource = z.enum(['MANUAL', 'AUTO']);
export const Category = z.enum(['PRODUCTIVE', 'UNPRODUCTIVE', 'NEUTRAL']);
export const ShotStatus = z.enum(['PENDING', 'READY', 'REDACTED']);
/**
 * Which client wrote a row. Deliberately closed and short: this exists to tell a Mac session
 * from a Windows one in "who is tracking now", not to fingerprint a device. There is no
 * UNKNOWN member — absence is expressed by the field being null, which is what every row
 * written before the field existed, and every not-yet-updated client, will carry forever.
 */
export const Platform = z.enum(['MACOS', 'WINDOWS']);

export type Role = z.infer<typeof Role>;
export type EntrySource = z.infer<typeof EntrySource>;
export type Category = z.infer<typeof Category>;
export type ShotStatus = z.infer<typeof ShotStatus>;
export type Platform = z.infer<typeof Platform>;
