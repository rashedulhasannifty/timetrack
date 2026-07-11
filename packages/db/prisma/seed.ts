import { config } from 'dotenv';
config({ path: ['../../.env', '.env'] });

import { PrismaClient, pgAdapter } from '../src/index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required to seed');

const prisma = new PrismaClient({ adapter: pgAdapter(url) });

async function main(): Promise<void> {
  const team = await prisma.team.upsert({
    where: { id: '019797a0-0000-7000-8000-000000000001' },
    update: {},
    create: {
      id: '019797a0-0000-7000-8000-000000000001',
      name: 'Engineering',
      // TeamSettingsSchema applies all defaults on read, so {} is a valid policy.
      settings: {},
    },
  });

  // Password hashing is Argon2id in the API's AuthService (PRD §6.8). Seed real users
  // through the API so a hash is never written by hand here.
  process.stdout.write(`seeded team ${team.name}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${String(err)}\n`);
    return prisma.$disconnect();
  });
