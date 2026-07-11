import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration (replaces `datasource.url` in schema.prisma and the removed
 * PrismaClient `datasourceUrl`). The CLI (migrate/generate) reads the connection URL
 * from here; the runtime client connects via the @prisma/adapter-pg adapter built in
 * src/index.ts.
 *
 * The Prisma CLI runs with this package as its cwd, so the repo-root .env is two levels
 * up. In CI, DATABASE_URL is already in process.env and dotenv simply finds no file —
 * existing env always wins, so the CI value is never overwritten.
 */
config({ path: ['../../.env', '.env'] });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
