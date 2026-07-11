// Placeholder env for integration tests that construct services calling loadEnv().
// DATABASE_URL and REDIS_URL come from the harness containers; these fill the rest.
// Never real secrets. Idempotent (??=) so a real container URL is never overwritten.
process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'change-me-32-chars-minimum-000000';
process.env.JWT_REFRESH_SECRET ??= 'change-me-32-chars-minimum-111111';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'test-bucket';
process.env.S3_ACCESS_KEY ??= 'test';
process.env.S3_SECRET_KEY ??= 'test';
process.env.API_URL ??= 'http://localhost:3001';
process.env.DATABASE_URL ??=
  'postgresql://timetrack:timetrack@localhost:5432/timetrack_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
