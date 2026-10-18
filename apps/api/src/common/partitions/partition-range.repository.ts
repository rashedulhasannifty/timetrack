import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** The monthly-partitioned tables (PRD §7.3). Partition key: `timestamp`. */
export type PartitionedTable = 'activity_samples' | 'screenshots';

/**
 * CLAUDE.md §3 — Prisma lives in *.repository.ts. Reads the partitions that actually exist
 * right now from the catalog: retention DROPs old ones and the worker's partition-provision
 * job adds new ones, so any hardcoded window would drift from what Postgres will accept.
 */
@Injectable()
export class PartitionRangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One `pg_get_expr(relpartbound)` string per partition of `table`, e.g.
   * `FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00')`, or `DEFAULT`.
   * Scoped to the connection's current schema so a same-named table elsewhere can't leak in.
   */
  async listPartitionBounds(table: PartitionedTable): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ bound: string }[]>`
      SELECT pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = ${table}
        AND p.relnamespace = current_schema()::regnamespace
    `;
    return rows.map((r) => r.bound);
  }
}
