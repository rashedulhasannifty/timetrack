// Placeholder env for the worker e2e suite, mirroring apps/api/test/test-env.ts.
//
// The processors construct providers that call loadEnv(), which validates the WHOLE env
// schema — so a spec touching S3 also needs the JWT secrets it will never use. Without
// these, loadEnv falls back to walking up to the repo-root `.env`, which means the suite
// passes on a developer machine and dies on a clean one. That is exactly what happened the
// first time this suite ran in CI.
//
// Never real secrets. Idempotent (??=) so a harness container URL is never overwritten.
process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'change-me-32-chars-minimum-000000';
process.env.JWT_REFRESH_SECRET ??= 'change-me-32-chars-minimum-111111';
process.env.API_URL ??= 'http://localhost:3001';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'test-bucket';
process.env.S3_ACCESS_KEY ??= 'test';
process.env.S3_SECRET_KEY ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://timetrack:timetrack@localhost:5432/timetrack_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
