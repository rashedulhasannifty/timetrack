import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { loadEnv } from '@timetrack/config';

/**
 * Queue names — the api<->worker contract. These MUST match the @Processor(...)
 * names in apps/worker/src/processors. Producers live here (PRD §7.1.2); the API
 * never runs a consumer.
 */
export const QUEUES = {
  screenshotProcess: 'screenshot-process',
  rollupDaily: 'rollup-daily',
  retention: 'retention',
  partitionProvision: 'partition-provision',
  email: 'email',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * CLAUDE.md §3 — a background job is enqueued here, never run inline. The worker
 * (apps/worker) is separately deployable so a slow thumbnail job never touches API
 * latency (PRD §7.1.3).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly env = loadEnv();
  private readonly connection = (() => {
    const url = new URL(this.env.REDIS_URL);
    return { host: url.hostname, port: Number(url.port) || 6379 };
  })();
  private readonly queues = new Map<QueueName, Queue>();

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  enqueue<T extends object>(name: QueueName, jobName: string, data: T): Promise<unknown> {
    return this.queue(name).add(jobName, data, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
