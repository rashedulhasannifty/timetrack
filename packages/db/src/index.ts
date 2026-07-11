import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7's `prisma-client` generator emits `client.ts` (no index barrel).
export { PrismaClient, Prisma } from '../generated/client/client.js';
export type * from '../generated/client/client.js';

/**
 * Prisma 7 connects through a driver adapter, not a connection string on the client.
 * This factory keeps @prisma/adapter-pg confined to packages/db — apps construct the
 * client via `new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) })` without
 * taking a direct dependency on the adapter package.
 */
export function pgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString });
}

export { seedAdmin } from './seed-admin.js';
export type { SeedAdminInput } from './seed-admin.js';
