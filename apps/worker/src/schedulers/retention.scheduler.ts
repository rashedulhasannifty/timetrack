import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';

/**
 * PRD §10 / §7.3 — nightly retention plus nightly partition provisioning. Provisioning is
 * enqueued here (its queue/processor existed but was never scheduled) so next month's
 * partition always exists before inserts/retention need it. Provision (03:10) runs before
 * retention (03:20). Idempotent (upsertJobScheduler) so every boot/replica converges to one.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue('retention') private readonly retention: Queue,
    @InjectQueue('partition-provision') private readonly provision: Queue,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.provision.upsertJobScheduler(
      'partition-provision-cron',
      { pattern: '10 3 * * *', tz: 'UTC' },
      { name: 'partition-provision', data: {} },
    );
    await this.retention.upsertJobScheduler(
      'retention-cron',
      { pattern: '20 3 * * *', tz: 'UTC' },
      { name: 'retention', data: {} },
    );
    this.logger.log('retention + partition-provision schedulers registered (03:10/03:20 UTC)');
  }
}
