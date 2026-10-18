import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { monthPartition, monthStartsAhead, PROVISION_MONTHS_AHEAD } from './partition.util.js';

const PARTITIONED_TABLES = ['activity_samples', 'screenshots'] as const;

/**
 * PRD §7.3 — keeps the current month and the next PROVISION_MONTHS_AHEAD months partitioned for
 * each high-volume table. Provisioning only one month ahead meant a single failed run at a month
 * boundary left current data with nowhere to land; with a three-month lead, the job can fail for
 * weeks before ingest notices. Still a job to alert on.
 *
 * The DDL is idempotent (IF NOT EXISTS): an existing partition — and its rows — is untouched, so
 * re-running is safe. No DEFAULT partition is created: once one holds a row in a month's range,
 * the later CREATE ... PARTITION OF for that month fails. The API drops/rejects timestamps that
 * have no partition instead.
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

  async process(job?: Job<{ now?: string }>): Promise<void> {
    const now = job?.data?.now ? new Date(job.data.now) : new Date();
    for (const monthStart of monthStartsAhead(now, PROVISION_MONTHS_AHEAD)) {
      for (const table of PARTITIONED_TABLES) {
        await this.provision(table, monthStart);
      }
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
