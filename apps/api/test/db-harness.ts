import { execSync } from 'node:child_process';
import { MinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { PrismaClient, pgAdapter } from '@timetrack/db';

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

export async function startTestDb(opts: StartTestDbOptions = {}): Promise<TestDb> {
  const pg = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = pg.getConnectionUri();
  process.env.DATABASE_URL = url;

  execSync('pnpm --filter @timetrack/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

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
      await pg.stop();
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
