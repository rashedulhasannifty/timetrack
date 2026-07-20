import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { pinoConfig } from '@timetrack/logger';
import { loadEnv } from '@timetrack/config';
import { WorkerPrisma } from './infra/prisma.provider.js';
import { WorkerS3 } from './infra/s3.provider.js';
import { RetentionCleanupProcessor } from './processors/retention-cleanup.processor.js';
import { ScreenshotProcessProcessor } from './processors/screenshot-process.processor.js';
import { RollupDailyProcessor } from './processors/rollup-daily.processor.js';
import { PartitionProvisionProcessor } from './processors/partition-provision.processor.js';
import { EmailProcessor } from './processors/email/email.processor.js';
import { TimesheetGenerateProcessor } from './processors/timesheet-generate.processor.js';
import { RollupScheduler } from './schedulers/rollup.scheduler.js';
import { TimesheetScheduler } from './schedulers/timesheet.scheduler.js';

const env = loadEnv();
const redis = new URL(env.REDIS_URL);
const connection = { host: redis.hostname, port: Number(redis.port) || 6379 };

/**
 * PRD §7.1.3 — the worker is a standalone Nest application (no HTTP). It consumes the
 * same BullMQ queues the API produces to; queue names must match apps/api's QUEUES.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoConfig(env) }),
    BullModule.forRoot({ connection }),
    BullModule.registerQueue(
      { name: 'screenshot-process' },
      { name: 'rollup-daily' },
      { name: 'retention' },
      { name: 'partition-provision' },
      { name: 'email' },
      { name: 'timesheet-generate' },
    ),
  ],
  providers: [
    WorkerPrisma,
    WorkerS3,
    RetentionCleanupProcessor,
    ScreenshotProcessProcessor,
    RollupDailyProcessor,
    PartitionProvisionProcessor,
    EmailProcessor,
    TimesheetGenerateProcessor,
    RollupScheduler,
    TimesheetScheduler,
  ],
})
export class WorkerModule {}
