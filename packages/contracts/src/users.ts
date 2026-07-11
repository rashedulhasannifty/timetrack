import { z } from 'zod';
import { Role } from './enums.js';

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: Role,
  teamId: z.uuid(),
  /** PRD §4.1 — null means monitoring MUST NOT run for this user. */
  monitoringAckAt: z.iso.datetime().nullable(),
  deactivatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const InviteUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(200),
  role: Role.default('EMPLOYEE'),
  teamId: z.uuid(),
});

/**
 * PRD §4.1 — the client POSTs this once the signed-in user acknowledges the
 * monitoring policy. It sets users.monitoring_ack_at. There is no admin override.
 */
export const AckMonitoringSchema = z.object({
  policyVersion: z.string().min(1),
});

export type User = z.infer<typeof UserSchema>;
export type InviteUser = z.infer<typeof InviteUserSchema>;
export type AckMonitoring = z.infer<typeof AckMonitoringSchema>;
