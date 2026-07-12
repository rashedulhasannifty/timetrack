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
const EnvSchema = z.object({
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

  API_PORT: z.coerce.number().int().default(3001),
  API_URL: z.url(),

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
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  loadDotEnvOnce();
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
