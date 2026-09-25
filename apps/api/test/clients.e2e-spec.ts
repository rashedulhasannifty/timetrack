import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Logger } from 'nestjs-pino';
import { ClientsRepository } from '../src/modules/clients/clients.repository.js';
import { ClientsService } from '../src/modules/clients/clients.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';
const admin: SessionUser = { id: 'admin1', role: 'ADMIN', teamId: '' };

describe.runIf(RUN_E2E)('client versions — real Postgres', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  function svc(): ClientsService {
    const repo = new ClientsRepository(db.prisma as unknown as PrismaService);
    return new ClientsService(repo, { warn: () => undefined } as unknown as Logger);
  }

  async function seedUser(email: string) {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    return db.prisma.user.create({
      data: { email, name: 'E', teamId: team.id, passwordHash: 'x' },
      select: { id: true },
    });
  }

  it('keeps one row per platform and moves it forward on each sign-in', async () => {
    const user = await seedUser('a@ex.co');
    await svc().record(user.id, { platform: 'MACOS', version: '0.6.1' });
    await svc().record(user.id, { platform: 'WINDOWS', version: '0.2.1' });
    await svc().record(user.id, { platform: 'MACOS', version: '0.7.0' });

    const rows = await svc().list(admin);
    expect(rows.map((r) => [r.platform, r.version])).toEqual([
      ['MACOS', '0.7.0'],
      ['WINDOWS', '0.2.1'],
    ]);
    expect(await db.prisma.clientInstall.count()).toBe(2);
  });

  it('swallows a write that cannot land, e.g. for a user that does not exist', async () => {
    await expect(
      svc().record('019797a0-0000-7000-8000-000000000404', { platform: 'MACOS', version: '1.0' }),
    ).resolves.toBeUndefined();
    expect(await db.prisma.clientInstall.count()).toBe(0);
  });
});
