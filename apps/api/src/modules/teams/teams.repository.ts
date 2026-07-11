import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  getById(id: string): Promise<{ id: string; name: string; settings: unknown } | null> {
    return this.prisma.team.findUnique({
      where: { id },
      select: { id: true, name: true, settings: true },
    });
  }

  // TODO(scaffold): updateSettings(teamId, patch) — validate the MERGED object through
  //                 TeamSettingsSchema before writing (never persist an unvalidated patch).
}
