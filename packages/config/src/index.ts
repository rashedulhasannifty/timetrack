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

/** The dev-only APP_URL. Leaving this in place in production is rejected below. */
const APP_URL_DEV_DEFAULT = 'http://localhost:3000';

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

    // The dashboard's PUBLIC origin — the base of the accept link in an invite email.
    // Distinct from API_URL (the API's own origin, which the dashboard reaches internally)
    // and from CORS_ORIGINS (a list). Defaults to the dev dashboard so a link is always
    // buildable; production must set the real origin (enforced by the refinement below).
    APP_URL: z.url().default(APP_URL_DEV_DEFAULT),

    // PRD §6.7 — invitation lifetime. `expiresAt` is computed at create time and persisted,
    // so changing this never extends invites that have already been sent.
    INVITE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),

    // Outbound email over SMTP. All five are OPTIONAL and all-or-nothing, exactly like OIDC
    // below: set them together to enable sending, or leave every one unset to disable it
    // (the refinement rejects a half-configured state at boot). When unset the worker logs
    // the accept link instead of sending — a development path, never a production one.
    // Any SMTP provider works; with SES use the SMTP endpoint + SMTP password (which is NOT
    // the IAM secret access key — it is derived from it and only valid for SMTP).
    SMTP_HOST: z.string().min(1).optional(),
    // 587 = STARTTLS (the usual choice), 465 = implicit TLS.
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    // RFC 5322 From — `user@domain` or `Display Name <user@domain>`. With SES the identity
    // must be verified in the sending region, or every send fails at the envelope.
    MAIL_FROM: z.string().min(1).optional(),

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
    // A production deployment that never set APP_URL would boot healthy and mail every
    // invitee a localhost link — a silent failure only a confused employee would surface.
    // Fail at boot instead, consistent with every other required URL in this schema.
    if (env.NODE_ENV === 'production' && env.APP_URL === APP_URL_DEV_DEFAULT) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message:
          "APP_URL must be the deployment's public dashboard origin in production, not the localhost default (invite links are built from it)",
      });
    }

    // SMTP is all-or-nothing for the same reason as OIDC: a half-set config is an operator
    // error. Fail fast at boot rather than have the invite job throw on the first send.
    const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;
    const smtpSetCount = smtpKeys.filter((k) => env[k] !== undefined).length;
    if (smtpSetCount !== 0 && smtpSetCount !== smtpKeys.length) {
      for (const k of smtpKeys) {
        if (env[k] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message:
              'Email config is all-or-nothing: set every SMTP_*/MAIL_FROM var or none of them',
          });
        }
      }
    }

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

/**
 * The SMTP settings, present only when email is fully configured. `null` means sending is
 * disabled — the single source of truth for "can we send mail?". The all-or-nothing
 * refinement above guarantees these five are either all set or all undefined.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** Implicit TLS on 465; 587 and others use STARTTLS. */
  secure: boolean;
}

export function smtpConfig(env: Env): SmtpConfig | null {
  if (
    env.SMTP_HOST === undefined ||
    env.SMTP_PORT === undefined ||
    env.SMTP_USER === undefined ||
    env.SMTP_PASS === undefined ||
    env.MAIL_FROM === undefined
  ) {
    return null;
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
    secure: env.SMTP_PORT === 465,
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
