import './test-env.js'; // must run before anything that calls loadEnv()
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Inject, VersioningType, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { ProblemJsonFilter } from '../src/common/filters/problem-json.filter.js';
import { MonitoringAckGuard } from '../src/common/guards/monitoring-ack.guard.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { PolicyRepository } from '../src/modules/policy/policy.repository.js';
import { PolicyService } from '../src/modules/policy/policy.service.js';
import { ScreenshotsController } from '../src/modules/screenshots/screenshots.controller.js';
import { ScreenshotsService } from '../src/modules/screenshots/screenshots.service.js';
import { ScreenshotsRepository } from '../src/modules/screenshots/screenshots.repository.js';
import { ActivityController } from '../src/modules/activity/activity.controller.js';
import { ActivityService } from '../src/modules/activity/activity.service.js';
import { ActivityRepository } from '../src/modules/activity/activity.repository.js';
import { IdleEventsController } from '../src/modules/idle-events/idle-events.controller.js';
import { IdleEventsService } from '../src/modules/idle-events/idle-events.service.js';
import { IdleEventsRepository } from '../src/modules/idle-events/idle-events.repository.js';
import { MinioService } from '../src/infra/storage/minio.service.js';
import type { QueueService } from '../src/infra/queue/queue.module.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { PartitionRangeRepository } from '../src/common/partitions/partition-range.repository.js';
import { PartitionRangeService } from '../src/common/partitions/partition-range.service.js';
import type { Logger } from 'nestjs-pino';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * CLAUDE.md §1 — "If a user has not acknowledged the policy, the client does not capture." The
 * clients enforce that with AckGate; this suite proves the SERVER enforces it too, over real HTTP
 * (Fastify + multipart + the global problem+json filter) against real Postgres and MinIO, so an
 * old, buggy or modified client cannot get capture data stored by skipping its own gate.
 *
 * Only authentication is stubbed (a header carries the session user, standing in for the JWT
 * guard). The monitoring gate, policy lookup, controllers, services and repositories are the
 * production classes.
 */

// vitest transforms TS with esbuild, which emits no `design:paramtypes`, so Nest cannot see the
// controllers' constructor types here (see app-bootstrap.e2e-spec.ts). Declare them explicitly.
Inject(ScreenshotsService)(ScreenshotsController, undefined, 0);
Inject(ActivityService)(ActivityController, undefined, 0);
Inject(IdleEventsService)(IdleEventsController, undefined, 0);

/** Stands in for JwtAuthGuard: the session user arrives verified, as JSON in a test header. */
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: SessionUser }>();
    req.user = JSON.parse(req.headers['x-test-user'] ?? 'null') as SessionUser;
    return true;
  }
}

const TS = '2026-07-16T10:00:00.000Z';
const BOUNDARY = 'ttboundary';

function multipartBody(id: string): string {
  const field = (name: string, value: string) =>
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  return (
    field('id', id) +
    field('timestamp', TS) +
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="s.png"\r\n` +
    `Content-Type: image/png\r\n\r\nPNGDATA\r\n--${BOUNDARY}--\r\n`
  );
}

describe.runIf(RUN_E2E)('monitoring acknowledgement gate on capture ingest — real HTTP', () => {
  let db: TestDb;
  let storage: MinioService;
  let app: NestFastifyApplication;
  const enqueue = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    db = await startTestDb({ minio: true });
    storage = new MinioService();
    await storage.onModuleInit();
    const prisma = db.prisma as unknown as PrismaService;
    const partitions = new PartitionRangeService(new PartitionRangeRepository(prisma));
    const logger = { warn: vi.fn() } as unknown as Logger;

    const moduleRef = await Test.createTestingModule({
      controllers: [ScreenshotsController, ActivityController, IdleEventsController],
      providers: [
        {
          provide: PolicyService,
          useFactory: () => new PolicyService(new PolicyRepository(prisma)),
        },
        {
          provide: ScreenshotsService,
          useFactory: () =>
            new ScreenshotsService(
              new ScreenshotsRepository(prisma),
              storage,
              { enqueue } as unknown as QueueService,
              partitions,
              logger,
            ),
        },
        {
          provide: ActivityService,
          useFactory: () => new ActivityService(new ActivityRepository(prisma), partitions, logger),
        },
        {
          provide: IdleEventsService,
          useFactory: () => new IdleEventsService(new IdleEventsRepository(prisma)),
        },
        // Same order as AppModule: authentication first, the monitoring gate after it.
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: MonitoringAckGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new ProblemJsonFilter({ error: vi.fn() } as never));
    await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  afterEach(async () => {
    await truncateAll(db.prisma);
    vi.restoreAllMocks();
    enqueue.mockClear();
  });

  async function seedUser(opts: {
    acked: boolean;
    settings?: Record<string, unknown>;
  }): Promise<SessionUser> {
    const team = await db.prisma.team.create({
      data: { name: 'Team', settings: (opts.settings ?? {}) as object },
    });
    const user = await db.prisma.user.create({
      data: {
        email: `u-${Math.random().toString(36).slice(2)}@example.test`,
        name: 'Employee',
        teamId: team.id,
        monitoringAckAt: opts.acked ? new Date() : null,
      },
    });
    return { id: user.id, role: 'EMPLOYEE', teamId: team.id };
  }

  function postScreenshot(user: SessionUser, id: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/screenshots',
      headers: {
        'x-test-user': JSON.stringify(user),
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: multipartBody(id),
    });
  }

  function postActivity(user: SessionUser, windowTitle: string | null = 'Quarterly plan.docx') {
    return app.inject({
      method: 'POST',
      url: '/v1/activity-samples/batch',
      headers: { 'x-test-user': JSON.stringify(user) },
      payload: {
        samples: [
          {
            id: '019797a0-0000-7000-8000-0000000000a1',
            timestamp: TS,
            appName: 'Word',
            windowTitle,
            activityPct: 70,
          },
        ],
      },
    });
  }

  function postIdle(user: SessionUser) {
    return app.inject({
      method: 'POST',
      url: '/v1/idle-events',
      headers: { 'x-test-user': JSON.stringify(user) },
      payload: {
        id: '019797a0-0000-7000-8000-0000000000b1',
        startTime: '2026-07-16T09:00:00.000Z',
        endTime: '2026-07-16T09:05:00.000Z',
        resolvedAction: 'DISCARDED',
      },
    });
  }

  const shotId = '019797a0-0000-7000-8000-0000000000c1';

  async function objectExists(key: string): Promise<boolean> {
    const res = await fetch(await storage.presignGet(key));
    return res.status === 200;
  }

  describe('unacknowledged user → 403 problem+json, nothing stored', () => {
    it('screenshot upload: 403, no row, and the image never reaches storage', async () => {
      const user = await seedUser({ acked: false });
      const put = vi.spyOn(storage, 'putStream');

      const res = await postScreenshot(user, shotId);

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({
        status: 403,
        title: 'Monitoring policy not acknowledged',
      });
      expect(put).not.toHaveBeenCalled();
      expect(await objectExists(`raw/${user.id}/${shotId}`)).toBe(false);
      expect(await db.prisma.screenshot.count()).toBe(0);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('activity batch: 403 and no samples stored', async () => {
      const user = await seedUser({ acked: false });
      const res = await postActivity(user);
      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(await db.prisma.activitySample.count()).toBe(0);
    });

    it('idle event: 403 and no event stored', async () => {
      const user = await seedUser({ acked: false });
      const res = await postIdle(user);
      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(await db.prisma.idleEvent.count()).toBe(0);
    });
  });

  describe('acknowledged user → stored as before', () => {
    it('screenshot upload: 201, PENDING row, object in storage', async () => {
      const user = await seedUser({ acked: true });
      const res = await postScreenshot(user, shotId);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: shotId, status: 'PENDING' });
      expect(await objectExists(`raw/${user.id}/${shotId}`)).toBe(true);
      expect(enqueue).toHaveBeenCalledOnce();
    });

    it('activity batch: 201 and the window title is kept (team default captures titles)', async () => {
      const user = await seedUser({ acked: true });
      const res = await postActivity(user);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ accepted: 1 });
      const row = await db.prisma.activitySample.findFirstOrThrow();
      expect(row.userId).toBe(user.id);
      expect(row.windowTitle).toBe('Quarterly plan.docx');
    });

    it('idle event: 201 and stored', async () => {
      const user = await seedUser({ acked: true });
      const res = await postIdle(user);
      expect(res.statusCode).toBe(201);
      expect(await db.prisma.idleEvent.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe('team settings', () => {
    it('screenshots disabled for the team: 403 even when acknowledged, nothing stored', async () => {
      const user = await seedUser({ acked: true, settings: { screenshotsEnabled: false } });
      const put = vi.spyOn(storage, 'putStream');

      const res = await postScreenshot(user, shotId);

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ status: 403, title: 'Capture disabled by team policy' });
      expect(put).not.toHaveBeenCalled();
      expect(await objectExists(`raw/${user.id}/${shotId}`)).toBe(false);
      expect(await db.prisma.screenshot.count()).toBe(0);
    });

    it('window titles disabled for the team: the batch is accepted, the title stored as null', async () => {
      const user = await seedUser({ acked: true, settings: { captureWindowTitles: false } });
      const res = await postActivity(user);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ accepted: 1 });
      const row = await db.prisma.activitySample.findFirstOrThrow();
      expect(row.windowTitle).toBeNull();
      expect(row.appName).toBe('Word');
    });
  });
});

describe('monitoring-ack e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
