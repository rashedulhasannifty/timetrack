import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient, pgAdapter } from '@timetrack/db';

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  close(): Promise<void>;
}

/**
 * Boot a throwaway Postgres 18, apply all migrations, and return a connected
 * Prisma client. Integration/e2e specs use this instead of a mocked Prisma
 * (CLAUDE.md §5). One container per spec file — vitest.e2e.config has
 * fileParallelism off, so containers never run concurrently.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = container.getConnectionUri();

  // prisma.config.ts reads DATABASE_URL via env('DATABASE_URL') and its dotenv call
  // never overwrites an already-set var, so the migrate child inherits this URL.
  execSync('pnpm --filter @timetrack/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({ adapter: pgAdapter(url) });
  return {
    prisma,
    url,
    async close() {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}

/**
 * Truncate every application table (partitions cascade) between tests, leaving
 * Prisma's migration bookkeeping intact. The table set is read from the catalog
 * so newly-added tables and monthly partitions are covered automatically.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
