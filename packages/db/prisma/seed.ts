import { config } from 'dotenv';
config({ path: ['../../.env', '.env'] });

import { PrismaClient, pgAdapter, seedAdmin } from '../src/index.js';

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
  process.stdout.write(`seeded team ${team.name}\n`);

  // Bootstrap ADMIN from env (optional). Both vars required; skip otherwise so
  // `pnpm db:seed` still works with no admin configured. The seed can't import
  // @timetrack/config (packages import only contracts), so it validates inline.
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password && password.length >= 8) {
    const admin = await seedAdmin(prisma, { email, password, teamId: team.id });
    process.stdout.write(`seeded admin ${admin.email}\n`);
  } else if (email || password) {
    process.stdout.write(
      'SEED_ADMIN_EMAIL/PASSWORD incomplete (need both; password >= 8 chars) — skipping admin\n',
    );
  } else {
    process.stdout.write('no SEED_ADMIN_* set — skipping admin seed\n');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${String(err)}\n`);
    return prisma.$disconnect();
  });
