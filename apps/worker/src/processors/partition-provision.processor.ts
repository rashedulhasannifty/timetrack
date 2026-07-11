import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { monthPartition, nextMonthStart } from './partition.util.js';

const PARTITIONED_TABLES = ['activity_samples', 'screenshots'] as const;

/**
 * PRD §7.3 — pre-creates NEXT month's partition for each high-volume table. If this job
 * ever fails, inserts into an unprovisioned range fail — this is a job to alert on.
 * The DDL is idempotent (IF NOT EXISTS), so re-running is safe.
 */
@Injectable()
@Processor('partition-provision')
export class PartitionProvisionProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(): Promise<void> {
    const monthStart = nextMonthStart(new Date());
    for (const table of PARTITIONED_TABLES) {
      await this.provision(table, monthStart);
    }
  }

  private async provision(table: string, monthStart: Date): Promise<void> {
    const { suffix, from, to } = monthPartition(monthStart);
    // Identifiers/dates are computed from numbers here — no user input, no injection.
    const sql =
      `CREATE TABLE IF NOT EXISTS "${table}_${suffix}" PARTITION OF "${table}" ` +
      `FOR VALUES FROM ('${from}') TO ('${to}')`;
    await this.prisma.$executeRawUnsafe(sql);
    this.logger.log({ table, suffix }, 'partition ensured');
  }
}
