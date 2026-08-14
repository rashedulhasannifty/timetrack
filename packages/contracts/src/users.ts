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

/**
 * PATCH /v1/users/:id — an ADMIN mutates another user: deactivate/reactivate (`deactivated`),
 * change their role (`role`), and/or move them to another team (`teamId`). All optional but at
 * least one must be present, so an empty body is a 422 rather than a silent no-op. `.strict()`
 * is baked in (the pipe can't add it once `.refine` wraps this in a ZodEffects) so an
 * unexpected field is still rejected.
 *
 * `teamId` is how an employee is assigned to a manager: a MANAGER manages their own team, so
 * moving someone's team IS reassigning who manages them. That makes it a permissions change,
 * not a field edit — the old team's manager loses sight of that person's history and the new
 * one gains it — so it is audited like `role`.
 */
export const UpdateUserSchema = z
  .object({
    deactivated: z.boolean().optional(),
    role: Role.optional(),
    teamId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => v.deactivated !== undefined || v.role !== undefined || v.teamId !== undefined, {
    message: 'Provide at least one of: deactivated, role, teamId',
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
