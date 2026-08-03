import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Local-dev convenience: load the nearest `.env` (searching up from cwd toward the repo
 * root) into process.env on first use. Production injects env directly, so a missing file
 * is fine, and values already in the environment always win (Node does not overwrite them).
 */
let dotenvLoaded = false;
function loadDotEnvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/**
 * PRD §7.2 — env is parsed through Zod at boot.
 * Missing or invalid env is a fail-fast startup error, never a runtime `undefined`.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    // Bootstrap-admin seed (optional). Consumed by packages/db/prisma/seed.ts, which
    // reads process.env directly (it cannot import this package — packages import only
    // contracts). Declared here to keep the canonical env schema complete; the API
    // runtime ignores them.
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('30d'),
    // Rotation grace: a just-rotated refresh token stays valid this many seconds so
    // concurrent dashboard tabs don't spuriously log each other out. Logout is never graced.
    REFRESH_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(10),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string(),
    S3_ACCESS_KEY: z.string(),
    S3_SECRET_KEY: z.string(),
    PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    TRACKING_FRESHNESS_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

    API_PORT: z.coerce.number().int().default(3001),
    API_URL: z.url(),

    // PRD §6.8 — SSO (OIDC), slice 4.4. All five are OPTIONAL and all-or-nothing: set
    // together to enable SSO, or leave every one unset to disable it (the refinement below
    // rejects a half-configured state at boot). Secrets never enter the repo. When unset,
    // the API's OIDC endpoints 404 and the dashboard hides the "Sign in with SSO" button.
    OIDC_ISSUER: z.url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    // The dashboard's `…/api/auth/sso/callback` URL, registered as the IdP redirect_uri.
    OIDC_REDIRECT_URI: z.url().optional(),
    // The team new SSO-provisioned users are placed in (role defaults to EMPLOYEE).
    OIDC_DEFAULT_TEAM_ID: z.uuid().optional(),

    // Comma-separated CORS origin allowlist. The API accepts cross-origin requests
    // ONLY from these origins (the dashboard). Never use '*' with credentials.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((env, ctx) => {
    // SSO (OIDC) is all-or-nothing: a half-set config is an operator error, not a runtime
    // fallback. Fail fast at boot rather than 500 on the first SSO login.
    const oidcKeys = [
      'OIDC_ISSUER',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_REDIRECT_URI',
      'OIDC_DEFAULT_TEAM_ID',
    ] as const;
    const setCount = oidcKeys.filter((k) => env[k] !== undefined).length;
    if (setCount !== 0 && setCount !== oidcKeys.length) {
      for (const k of oidcKeys) {
        if (env[k] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: 'OIDC config is all-or-nothing: set every OIDC_* var or none of them',
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * The OIDC settings, present only when SSO is fully configured. `null` means SSO is
 * disabled — the single source of truth for "is SSO on?" across the API. The all-or-nothing
 * refinement above guarantees these five are either all set or all undefined.
 */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  defaultTeamId: string;
}

export function oidcConfig(env: Env): OidcConfig | null {
  if (
    env.OIDC_ISSUER === undefined ||
    env.OIDC_CLIENT_ID === undefined ||
    env.OIDC_CLIENT_SECRET === undefined ||
    env.OIDC_REDIRECT_URI === undefined ||
    env.OIDC_DEFAULT_TEAM_ID === undefined
  ) {
    return null;
  }
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
    defaultTeamId: env.OIDC_DEFAULT_TEAM_ID,
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  loadDotEnvOnce();
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
