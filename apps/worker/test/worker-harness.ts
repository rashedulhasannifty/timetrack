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

  // MinIO's own images are no longer pullable anonymously: Docker Hub's minio/minio went first,
  // then quay.io/minio/minio started answering 401 on 2026-09-25 and took CI red on main. This is
  // Chainguard's build of the real MinIO server, which is a drop-in — its entrypoint is
  // /usr/bin/minio with no CMD, so the `server --console-address :9001 /data` that MinioContainer
  // appends lands exactly as it did before.
  //
  // Deliberately NOT digest-pinned. Chainguard's free tier publishes only `:latest` and garbage
  // collects superseded digests, so a pin here would rot into an unpullable reference — the very
  // failure this is fixing. Note that pinning would not have helped anyway: what broke was the
  // whole repository going private, not a tag moving.
  const minio = await new MinioContainer('chainguard/minio:latest').start();
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
