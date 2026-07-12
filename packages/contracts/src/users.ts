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

/** PATCH /v1/users/:id — deactivate (true) or reactivate (false) a user. */
export const UpdateUserSchema = z.object({
  deactivated: z.boolean(),
});

/**
 * Response of POST /v1/users/invite. No User exists yet (the user is created on accept),
 * so this returns the invite metadata. `devToken` is populated ONLY when
 * NODE_ENV === 'development' so a developer can complete the flow before SMTP exists —
 * it is a bearer secret and is never logged.
 */
export const InviteResultSchema = z.object({
  invite: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    teamId: z.uuid(),
    expiresAt: z.iso.datetime(),
  }),
  devToken: z.string().optional(),
});

export type User = z.infer<typeof UserSchema>;
export type InviteUser = z.infer<typeof InviteUserSchema>;
export type AckMonitoring = z.infer<typeof AckMonitoringSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type InviteResult = z.infer<typeof InviteResultSchema>;
