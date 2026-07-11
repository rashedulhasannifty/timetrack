import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One query — the user's ack timestamp plus their team's settings (no N+1). */
  getUserPolicy(
    userId: string,
  ): Promise<{ monitoringAckAt: Date | null; team: { settings: unknown } } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { monitoringAckAt: true, team: { select: { settings: true } } },
    });
  }
}
