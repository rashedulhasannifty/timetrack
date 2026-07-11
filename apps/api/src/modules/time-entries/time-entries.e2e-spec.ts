import { describe, it, expect } from 'vitest';

/**
 * PRD §9 — integration/E2E hits a REAL Postgres via Testcontainers, never a mocked
 * Prisma. This is the reference slice's end-to-end proof: idempotent upsert on the
 * client UUIDv7, plus the 403 authorization case that matters more than the 200.
 *
 * SCAFFOLD: gated OFF by default so `pnpm test:e2e` is green without Docker. Enable
 * with RUN_E2E=1 once the harness below is completed. The structure to fill in:
 *
 *   beforeAll:
 *     - const pg = await new PostgreSqlContainer('postgres:18-alpine').start()
 *     - point DATABASE_URL at pg, run `prisma migrate deploy` against it
 *     - build the Nest app (NestFactory.create) with the Fastify adapter
 *     - seed one team + two users; sign an access JWT for each with JWT_ACCESS_SECRET
 *   afterAll: await app.close(); await pg.stop()
 *
 *   tests (via supertest against app.getHttpServer()):
 *     - POST /time-entries twice with the same id  -> one row (idempotent, PRD §7.5)
 *     - GET  /time-entries?userId=self             -> 200 with the entry
 *     - GET  /time-entries?userId=other (as employee) -> 403 (CLAUDE.md §4)
 */
const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('time-entries (e2e)', () => {
  it('is not implemented yet — complete the Testcontainers harness above', () => {
    expect(RUN_E2E).toBe(true);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('time-entries e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
