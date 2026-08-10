import { describe, it, expect } from 'vitest';
import { loadEnv, sesConfig } from './index.js';

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

const ses = {
  SES_REGION: 'ap-southeast-1',
  SES_ACCESS_KEY_ID: 'AKIA_EXAMPLE',
  SES_SECRET_ACCESS_KEY: 'raw-iam-secret',
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

describe('SES config is all-or-nothing', () => {
  it('is disabled when no SES var is set', () => {
    expect(sesConfig(loadEnv(base))).toBeNull();
  });

  it('is enabled when every SES var is set', () => {
    expect(sesConfig(loadEnv({ ...base, ...ses }))).toEqual({
      region: 'ap-southeast-1',
      accessKeyId: 'AKIA_EXAMPLE',
      secretAccessKey: 'raw-iam-secret',
      from: 'TimeTrack <noreply@example.com>',
    });
  });

  it('rejects a half-configured mailer at boot rather than at first send', () => {
    const { MAIL_FROM: _omitted, ...partial } = ses;
    expect(() => loadEnv({ ...base, ...partial })).toThrow(/MAIL_FROM/);
  });
});
