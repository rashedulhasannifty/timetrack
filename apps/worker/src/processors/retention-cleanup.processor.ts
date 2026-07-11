import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { WorkerPrisma } from '../infra/prisma.provider.js';

/**
 * PRD §10 — retention is enforced by THIS JOB, not by policy prose.
 * Partitioned tables mean expiry is a DROP PARTITION, not a mass DELETE.
 * Every run writes an audit_log entry with counts.
 */
@Injectable()
@Processor('retention')
export class RetentionCleanupProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  process(): Promise<void> {
    // TODO(scaffold): for each team, resolve retention days from TeamSettingsSchema,
    // compute expired partitions, `DROP TABLE <partition>` via this.prisma.$executeRaw,
    // then write an AuditLog row with the counts (PRD §10).
    void this.prisma;
    this.logger.log('retention cleanup started');
    return Promise.resolve();
  }
}
