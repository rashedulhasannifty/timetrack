import { z } from 'zod';

/**
 * PRD §6.8 — SSO (OIDC) login alongside email/password (Phase 4, slice 4.4).
 *
 * Architecture: the API owns all OIDC protocol/crypto; the dashboard BFF owns the browser
 * redirects and the session cookie. These two schemas are the server-to-server contract
 * between them — the dashboard never talks to the IdP directly and never sees the client
 * secret. The response to a successful callback is the ordinary `TokenPair`.
 */

/**
 * API `POST /v1/auth/oidc/authorize` → this. The dashboard stores `state`, `nonce`, and
 * `codeVerifier` in a short encrypted httpOnly cookie and redirects the browser to
 * `authorizationUrl`. All three are single-use, per-request secrets minted by the API.
 */
export const OidcAuthorizeResultSchema = z.object({
  authorizationUrl: z.url(),
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
});

/**
 * Dashboard `sso/callback` → API `POST /v1/auth/oidc/callback` with this body. `code` and
 * `state` come from the IdP redirect; `nonce` and `codeVerifier` are replayed from the
 * dashboard's cookie so the API can bind the ID token to the request that started it.
 */
export const OidcCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
});

export type OidcAuthorizeResult = z.infer<typeof OidcAuthorizeResultSchema>;
export type OidcCallback = z.infer<typeof OidcCallbackSchema>;
