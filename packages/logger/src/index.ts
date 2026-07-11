import type { LoggerOptions } from 'pino';

/**
 * CLAUDE.md §4 — redaction is configured here, once, not at each call site.
 * Adding a sensitive field to a schema means adding it to this list IN THE SAME COMMIT.
 *
 * windowTitle is on this list deliberately: titles leak document names, ticket
 * subjects and URLs. It is arguably the most sensitive field in the schema (PRD §13).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.windowTitle',
  'windowTitle',
  '*.SEED_ADMIN_PASSWORD',
  'SEED_ADMIN_PASSWORD',
];

export function pinoConfig(env: { NODE_ENV: string; LOG_LEVEL: string }): LoggerOptions {
  const isDev = env.NODE_ENV === 'development';
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  };
}
