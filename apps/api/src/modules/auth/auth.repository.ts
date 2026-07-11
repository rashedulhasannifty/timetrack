import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * CLAUDE.md §3 — Prisma lives HERE. The credential read is real so the auth service
 * can be implemented against a stable seam; refresh-token persistence is scaffold.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<{
    id: string;
    email: string;
    passwordHash: string;
    role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
    teamId: string;
    deactivatedAt: Date | null;
  } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        teamId: true,
        deactivatedAt: true,
      },
    });
  }

  // TODO(scaffold): persistRefreshToken(userId, deviceId, tokenHash, expiresAt)
  // TODO(scaffold): findRefreshToken(tokenHash) / revokeRefreshToken(id)
  // These need a RefreshToken model + migration (PRD §6.8) before they can be written.
}
