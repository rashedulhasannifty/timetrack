import { Injectable } from '@nestjs/common';
import type { Platform } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface ClientInstallRow {
  userId: string;
  platform: Platform;
  version: string;
  lastSeenAt: Date;
}

/** CLAUDE.md §3 — Prisma lives HERE. */
@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One row per (user, platform); a newer sign-in overwrites the version and the time. */
  async upsert(row: ClientInstallRow): Promise<void> {
    await this.prisma.clientInstall.upsert({
      where: { userId_platform: { userId: row.userId, platform: row.platform } },
      create: row,
      update: { version: row.version, lastSeenAt: row.lastSeenAt },
      select: { id: true },
    });
  }

  list(): Promise<ClientInstallRow[]> {
    return this.prisma.clientInstall.findMany({
      select: { userId: true, platform: true, version: true, lastSeenAt: true },
      orderBy: [{ userId: 'asc' }, { platform: 'asc' }],
    });
  }
}
