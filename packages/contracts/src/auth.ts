import { z } from 'zod';
import { Role } from './enums.js';

/**
 * PRD §6.8 — email/password at launch; short-lived access JWT (15 min) + rotating
 * refresh token. Argon2id hashing happens in the API's AuthService, never here.
 */
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token lifetime in seconds. The client refreshes before this elapses. */
  expiresIn: z.number().int().positive(),
});

/**
 * The decoded access-token claims attached to every authenticated request.
 * This is the identity the guards and services authorize against — not a wire DTO,
 * but sourced here so the API and dashboard agree on its shape.
 */
export const JwtClaimsSchema = z.object({
  sub: z.uuid(),
  role: Role,
  teamId: z.uuid(),
});

/**
 * PRD §6.8 — an invited user sets their own password with the one-time token from
 * their invite email. Password bounds mirror LoginSchema. Accept auto-logs-in (TokenPair).
 */
export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export type Login = z.infer<typeof LoginSchema>;
export type Refresh = z.infer<typeof RefreshSchema>;
export type TokenPair = z.infer<typeof TokenPairSchema>;
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;
