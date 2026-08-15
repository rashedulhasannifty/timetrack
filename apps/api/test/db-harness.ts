import { MinioContainer } from '@testcontainers/minio';
import { RedisContainer } from '@testcontainers/redis';
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { inject } from 'vitest';

export interface StartTestDbOptions {
  redis?: boolean;
  minio?: boolean;
}

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  redisUrl?: string;
  s3Url?: string;
  close(): Promise<void>;
}

/** Swap the database name in a connection URL, keeping credentials, host and port. */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

// Unique per calling process, so names cannot collide if these ever run concurrently.
let seq = 0;

/**
 * A fresh, fully-migrated database for one describe block.
 *
 * The container and the schema come from test/global-setup.ts — started and migrated ONCE
 * per run. All this does is `CREATE DATABASE … TEMPLATE`, a file-level copy inside
 * Postgres: milliseconds, against the ~5s a container start plus a `prisma migrate deploy`
 * CLI spawn used to cost on each of the 27 call sites.
 *
 * Redis and MinIO stay per-call. Only four call sites ask for them, so sharing them would
 * add coupling for almost no time.
 */
export async function startTestDb(opts: StartTestDbOptions = {}): Promise<TestDb> {
  const testPg = inject('testPg');
  if (!testPg) {
    throw new Error(
      'startTestDb() needs the shared Postgres from test/global-setup.ts — run with RUN_E2E=1 ' +
        'under a vitest config that wires globalSetup.',
    );
  }

  const name = `tt_${process.pid}_${seq++}`;

  // CREATE DATABASE cannot run inside a transaction, and a template must have no other
  // sessions while it is copied — so issue it from `postgres` on a throwaway connection
  // rather than from the template itself.
  const admin = new PrismaClient({
    adapter: pgAdapter(withDatabase(testPg.templateUrl, 'postgres')),
  });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${testPg.templateDb}"`);
  } finally {
    await admin.$disconnect();
  }

  const url = withDatabase(testPg.templateUrl, name);
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ adapter: pgAdapter(url) });

  const redis = opts.redis ? await new RedisContainer('redis:8-alpine').start() : undefined;
  const redisUrl = redis?.getConnectionUrl();
  if (redisUrl) process.env.REDIS_URL = redisUrl;

  const minio = opts.minio ? await new MinioContainer('minio/minio:latest').start() : undefined;
  let s3Url: string | undefined;
  if (minio) {
    s3Url = minio.getConnectionUrl();
    process.env.S3_ENDPOINT = s3Url;
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = minio.getUsername();
    process.env.S3_SECRET_KEY = minio.getPassword();
    process.env.S3_BUCKET = 'timetrack-test';
  }

  return {
    prisma,
    url,
    redisUrl,
    s3Url,
    async close() {
      await prisma.$disconnect();
      // The database is left behind deliberately: global-setup stops the container at the
      // end of the run, which takes every copy with it, so DROP would only buy a second
      // admin connection per call.
      if (redis) await redis.stop();
      if (minio) await minio.stop();
    },
  };
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
