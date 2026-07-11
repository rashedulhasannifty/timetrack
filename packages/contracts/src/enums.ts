import { z } from 'zod';

export const Role = z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']);
export const EntrySource = z.enum(['MANUAL', 'AUTO']);
export const Category = z.enum(['PRODUCTIVE', 'UNPRODUCTIVE', 'NEUTRAL']);
export const ShotStatus = z.enum(['PENDING', 'READY', 'REDACTED']);

export type Role = z.infer<typeof Role>;
export type EntrySource = z.infer<typeof EntrySource>;
export type Category = z.infer<typeof Category>;
export type ShotStatus = z.infer<typeof ShotStatus>;
