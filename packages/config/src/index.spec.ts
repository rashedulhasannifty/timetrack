import { describe, it, expect } from 'vitest';
import { loadEnv, smtpConfig } from './index.js';

/** A minimally valid environment. Each test overrides only what it is about. */
const base: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://u:p@postgres:5432/db?schema=public',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'timetrack-screenshots',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  API_URL: 'https://timer.example.com',
};

const smtp = {
  SMTP_HOST: 'email-smtp.ap-southeast-1.amazonaws.com',
  SMTP_PORT: '587',
  SMTP_USER: 'AKIA_EXAMPLE',
  SMTP_PASS: 'smtp-derived-password',
  MAIL_FROM: 'TimeTrack <noreply@example.com>',
};

describe('APP_URL', () => {
  it('defaults to the dev dashboard outside production', () => {
    expect(loadEnv(base).APP_URL).toBe('http://localhost:3000');
  });

  it('rejects the localhost default in production — invite links are built from it', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/APP_URL/);
  });

  it('accepts a real origin in production', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      APP_URL: 'https://timer.example.com',
    });
    expect(env.APP_URL).toBe('https://timer.example.com');
  });
});

describe('INVITE_TTL_DAYS', () => {
  it('defaults to 7 days', () => {
    expect(loadEnv(base).INVITE_TTL_DAYS).toBe(7);
  });

  it('coerces a string and rejects an out-of-range value', () => {
    expect(loadEnv({ ...base, INVITE_TTL_DAYS: '14' }).INVITE_TTL_DAYS).toBe(14);
    expect(() => loadEnv({ ...base, INVITE_TTL_DAYS: '0' })).toThrow(/INVITE_TTL_DAYS/);
    expect(() => loadEnv({ ...base, INVITE_TTL_DAYS: '31' })).toThrow(/INVITE_TTL_DAYS/);
  });
});

describe('SMTP config is all-or-nothing', () => {
  it('is disabled when no SMTP var is set', () => {
    expect(smtpConfig(loadEnv(base))).toBeNull();
  });

  it('is enabled when every SMTP var is set, and uses STARTTLS on 587', () => {
    expect(smtpConfig(loadEnv({ ...base, ...smtp }))).toEqual({
      host: 'email-smtp.ap-southeast-1.amazonaws.com',
      port: 587,
      user: 'AKIA_EXAMPLE',
      pass: 'smtp-derived-password',
      from: 'TimeTrack <noreply@example.com>',
      secure: false,
    });
  });

  it('uses implicit TLS on 465', () => {
    const env = loadEnv({ ...base, ...smtp, SMTP_PORT: '465' });
    expect(smtpConfig(env)?.secure).toBe(true);
  });

  it('rejects a half-configured mailer at boot rather than at first send', () => {
    const { MAIL_FROM: _omitted, ...partial } = smtp;
    expect(() => loadEnv({ ...base, ...partial })).toThrow(/MAIL_FROM/);
  });
});
