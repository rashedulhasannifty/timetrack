import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { MinioContainer } from '@testcontainers/minio';
import { PrismaClient, pgAdapter } from '@timetrack/db';

export interface WorkerTestEnv {
  prisma: PrismaClient;
  close(): Promise<void>;
}

/** Postgres 18 + MinIO for the screenshot processor integration test. Sets S3_* + DATABASE_URL. */
export async function startWorkerEnv(): Promise<WorkerTestEnv> {
  const pg = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = pg.getConnectionUri();
  process.env.DATABASE_URL = url;
  execSync('pnpm --filter @timetrack/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const minio = await new MinioContainer('minio/minio:latest').start();
  process.env.S3_ENDPOINT = minio.getConnectionUrl();
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY = minio.getUsername();
  process.env.S3_SECRET_KEY = minio.getPassword();
  process.env.S3_BUCKET = 'timetrack-test';

  const prisma = new PrismaClient({ adapter: pgAdapter(url) });
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      await pg.stop();
      await minio.stop();
    },
  };
}
