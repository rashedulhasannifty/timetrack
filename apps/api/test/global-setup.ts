import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * ONE Postgres container for the whole e2e suite, migrated ONCE.
 *
 * Before this, `startTestDb()` started a container and shelled out to `prisma migrate
 * deploy` on every call — 27 calls across 19 files, each ~5s of setup for often only two
 * or three assertions. That was ~196s of CI, and it is why parallelising the files did not
 * help (PR #92): the per-file cost is a CPU-bound CLI spawn, so overlapping it just made
 * two cores contend. The fix is to stop doing the work, not to do it concurrently.
 *
 * Here the container starts once and the schema is migrated once, into the container's
 * default database. Each `startTestDb()` then does `CREATE DATABASE … TEMPLATE`, which is
 * a file-level copy inside Postgres — milliseconds, no CLI, no container.
 *
 * The template database must have NO other sessions while it is being copied, which is why
 * nothing ever connects to it after this file is done: callers connect to `postgres` to
 * issue the CREATE, then to their own fresh database.
 */

let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext) {
  // Unit-only runs (no RUN_E2E) must not pay for a container. The e2e specs are guarded by
  // `describe.runIf(RUN_E2E)`, so they will all skip and nothing will ask for this.
  if (process.env.RUN_E2E !== '1') {
    provide('testPg', null);
    return;
  }

  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const templateUrl = container.getConnectionUri();

  // The one and only `migrate deploy` of the run.
  execSync('pnpm --filter @timetrack/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: templateUrl },
    stdio: 'inherit',
  });

  provide('testPg', { templateUrl, templateDb: container.getDatabase() });

  return async () => {
    await container?.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testPg: { templateUrl: string; templateDb: string } | null;
  }
}
