import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { SYSTEM_ACTOR_ID, TeamSettingsSchema, type TeamSettings } from '@timetrack/contracts';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { WorkerS3 } from '../infra/s3.provider.js';
import {
  retentionCutoff,
  partitionBounds,
  isDroppable,
  PARTITION_NAME_RE,
} from './retention.util.js';

interface TableRetention {
  parent: 'screenshots' | 'activity_samples';
  field: 'screenshotRetentionDays' | 'activityRetentionDays';
  hasObjects: boolean;
}

const TABLES: TableRetention[] = [
  { parent: 'screenshots', field: 'screenshotRetentionDays', hasObjects: true },
  { parent: 'activity_samples', field: 'activityRetentionDays', hasObjects: false },
];

type TableReport = {
  droppedPartitions: string[];
  deletedRows: number;
  deletedObjects: number;
  deferred: { unit: string; reason: string }[];
};

/**
 * PRD §10 — retention enforced by THIS JOB. Global monthly partitions + per-team retention:
 * DROP a partition only when it is entirely past the LONGEST team's retention; a bounded
 * per-team DELETE clears stragglers above each team's own cutoff in still-live partitions.
 * Screenshot objects are deleted BEFORE their rows; any S3 failure defers that unit to the
 * next run (abort-and-retry) so a row is never dropped while its object survives.
 */
@Injectable()
@Processor('retention')
export class RetentionCleanupProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly s3: WorkerS3,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ now?: string }>): Promise<void> {
    const now = job.data?.now ? new Date(job.data.now) : new Date();

    const teams = await this.prisma.team.findMany({ select: { id: true, settings: true } });
    if (teams.length === 0) {
      this.logger.log({ reason: 'no teams' }, 'retention cleanup skipped');
      return;
    }
    const parsed = teams.map((t) => ({
      id: t.id,
      settings: TeamSettingsSchema.parse(t.settings ?? {}),
    }));

    const diff: Record<string, TableReport> = {};
    for (const table of TABLES) {
      diff[table.parent] = await this.sweepTable(table, parsed, now);
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: SYSTEM_ACTOR_ID,
        action: 'retention.cleanup',
        targetType: 'system',
        targetId: 'retention',
        diff,
      },
    });
    this.logger.log({ diff }, 'retention cleanup complete');
  }

  private async sweepTable(
    table: TableRetention,
    teams: { id: string; settings: TeamSettings }[],
    now: Date,
  ): Promise<TableReport> {
    const report: TableReport = {
      droppedPartitions: [],
      deletedRows: 0,
      deletedObjects: 0,
      deferred: [],
    };
    const maxDays = Math.max(...teams.map((t) => t.settings[table.field]));
    const cutoffMax = retentionCutoff(now, maxDays);

    // 1) DROP whole partitions entirely past the longest retention.
    const partitions = await this.listPartitions(table.parent);
    for (const name of partitions) {
      if (!PARTITION_NAME_RE.test(name)) continue; // skip default/non-conforming
      if (!isDroppable(partitionBounds(name), cutoffMax)) continue;
      try {
        if (table.hasObjects) report.deletedObjects += await this.deletePartitionObjects(name);
        await this.prisma.$executeRawUnsafe(`DROP TABLE "${name}"`);
        report.droppedPartitions.push(name);
      } catch (err) {
        report.deferred.push({ unit: name, reason: (err as Error).message });
        this.logger.log(
          { partition: name, err: (err as Error).message },
          'retention drop deferred',
        );
      }
    }

    // 2) Bounded per-team straggler DELETE above each team's own cutoff (live partitions).
    for (const team of teams) {
      const cutoff = retentionCutoff(now, team.settings[table.field]);
      try {
        if (table.hasObjects) {
          report.deletedObjects += await this.deleteTeamStragglerObjects(team.id, cutoff);
        }
        report.deletedRows += await this.deleteTeamStragglerRows(table.parent, team.id, cutoff);
      } catch (err) {
        report.deferred.push({ unit: `team:${team.id}`, reason: (err as Error).message });
        this.logger.log(
          { teamId: team.id, err: (err as Error).message },
          'retention straggler deferred',
        );
      }
    }
    return report;
  }

  private async listPartitions(parent: string): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = $1`,
      parent,
    );
    return rows.map((r) => r.relname);
  }

  /** Delete every screenshot object in a partition (about to be dropped). Returns object count. */
  private async deletePartitionObjects(partition: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<
      { storageKey: string; thumbnailKey: string | null }[]
    >(`SELECT "storageKey", "thumbnailKey" FROM "${partition}"`);
    const keys = rows.flatMap((r) => [r.storageKey, r.thumbnailKey ?? '']);
    await this.s3.deleteObjects(keys); // throws → caller defers the DROP
    return rows.length;
  }

  /** Delete a team's expired screenshot objects (before deleting their rows). Returns count. */
  private async deleteTeamStragglerObjects(teamId: string, cutoff: Date): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<
      { storageKey: string; thumbnailKey: string | null }[]
    >(
      `SELECT s."storageKey", s."thumbnailKey" FROM "screenshots" s
       WHERE s."userId" IN (SELECT id FROM "users" WHERE "teamId" = $1) AND s."timestamp" < $2`,
      teamId,
      cutoff,
    );
    if (rows.length === 0) return 0;
    const keys = rows.flatMap((r) => [r.storageKey, r.thumbnailKey ?? '']);
    await this.s3.deleteObjects(keys); // throws → caller defers the DELETE
    return rows.length;
  }

  private async deleteTeamStragglerRows(
    parent: string,
    teamId: string,
    cutoff: Date,
  ): Promise<number> {
    return this.prisma.$executeRawUnsafe(
      `DELETE FROM "${parent}"
       WHERE "userId" IN (SELECT id FROM "users" WHERE "teamId" = $1) AND "timestamp" < $2`,
      teamId,
      cutoff,
    );
  }
}
