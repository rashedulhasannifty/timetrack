import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { loadEnv } from '@timetrack/config';

/**
 * CLAUDE.md §3 — in the worker, Prisma is allowed inside processors/. This provider
 * is the single client they share. Prisma 7 connects through the pg driver adapter.
 */
@Injectable()
export class WorkerPrisma extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: pgAdapter(loadEnv().DATABASE_URL) });
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
