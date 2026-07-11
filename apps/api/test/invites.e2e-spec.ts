import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { InvitesRepository } from '../src/modules/invites/invites.repository.js';
import { InvitesService } from '../src/modules/invites/invites.service.js';
import { QueueService } from '../src/infra/queue/queue.module.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';
const admin: SessionUser = { id: 'admin1', role: 'ADMIN', teamId: '' };

describe.runIf(RUN_E2E)('invites accept — real Postgres', () => {
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

  function svc(): InvitesService {
    const repo = new InvitesRepository(db.prisma as unknown as PrismaService);
    const queue = { enqueue: async () => undefined } as unknown as QueueService;
    return new InvitesService(repo, queue);
  }

  it('accepts a valid invite once (creating the user); a replay is rejected', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const { token } = await svc().create(
      { email: 'new@ex.co', name: 'New', role: 'EMPLOYEE', teamId: team.id },
      { ...admin, teamId: team.id },
    );

    const accepted = await svc().accept(token, 'password123');
    expect(accepted.role).toBe('EMPLOYEE');
    const user = await db.prisma.user.findUnique({ where: { email: 'new@ex.co' } });
    expect(user).not.toBeNull();

    await expect(svc().accept(token, 'password123')).rejects.toThrow();
  });

  it('rejects an expired invite', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const { token } = await svc().create(
      { email: 'late@ex.co', name: 'Late', role: 'EMPLOYEE', teamId: team.id },
      { ...admin, teamId: team.id },
    );
    await db.prisma.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(svc().accept(token, 'password123')).rejects.toThrow();
  });

  it('rejects a second pending invite for the same email with 409', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const invite = { email: 'twice@ex.co', name: 'Twice', role: 'EMPLOYEE' as const, teamId: team.id };
    await svc().create(invite, { ...admin, teamId: team.id });
    await expect(svc().create(invite, { ...admin, teamId: team.id })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('accepting a duplicate invite after the email is taken returns 401, never a 500', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    // One invite via the service...
    const first = await svc().create(
      { email: 'dup@ex.co', name: 'Dup', role: 'EMPLOYEE', teamId: team.id },
      { ...admin, teamId: team.id },
    );
    // ...and a second pending invite for the SAME email, inserted directly to simulate a
    // race / a legacy row created before the invite-time guard existed.
    await db.prisma.invite.create({
      data: {
        email: 'dup@ex.co',
        name: 'Dup',
        role: 'EMPLOYEE',
        teamId: team.id,
        tokenHash: createHash('sha256').update('second-raw-token').digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await svc().accept(first.token, 'password123'); // creates the user
    expect(await db.prisma.user.findUnique({ where: { email: 'dup@ex.co' } })).not.toBeNull();

    // The second accept hits User.email uniqueness → a clean 401, not a raw Prisma P2002/500.
    await expect(svc().accept('second-raw-token', 'password123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe.runIf(RUN_E2E)('invites create — real Postgres + Redis', () => {
  let db: TestDb;
  let queueService: QueueService;
  let probe: Queue;

  beforeAll(async () => {
    db = await startTestDb({ redis: true });
    queueService = new QueueService();
    const url = new URL(db.redisUrl!);
    probe = new Queue('email', { connection: { host: url.hostname, port: Number(url.port) } });
  });
  afterAll(async () => {
    await probe.close();
    await queueService.onModuleDestroy();
    await db.close();
  });

  it('persists the invite and really enqueues an invite email job', async () => {
    const team = await db.prisma.team.create({ data: { name: 'Eng', settings: {} } });
    const repo = new InvitesRepository(db.prisma as unknown as PrismaService);
    const svc = new InvitesService(repo, queueService);

    await svc.create(
      { email: 'q@ex.co', name: 'Q', role: 'EMPLOYEE', teamId: team.id },
      { ...admin, teamId: team.id },
    );

    const jobs = await probe.getJobs(['waiting', 'delayed']);
    const invite = jobs.find((j) => j.name === 'invite');
    expect(invite).toBeTruthy();
    expect(invite?.data.email).toBe('q@ex.co');
    expect(invite?.data.inviteToken).toBeTruthy();
  });
});
