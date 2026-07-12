import { Injectable } from '@nestjs/common';
import type { Role } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  teamId: string;
  deactivatedAt: Date | null;
}

export interface AuthIdentity {
  id: string;
  role: Role;
  teamId: string;
  deactivatedAt: Date | null;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/**
 * CLAUDE.md §3 — Prisma lives HERE. Nothing in this file logs a password, hash, or token.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AuthUser | null> {
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

  /** Re-read the identity on refresh so a role/team change (or deactivation) takes effect. */
  findIdentityById(id: string): Promise<AuthIdentity | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, teamId: true, deactivatedAt: true },
    });
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<string> {
    const row = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
      select: { id: true },
    });
    return row.id;
  }

  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true, replacedById: true },
    });
  }

  async revokeRefreshToken(id: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt } });
  }

  /** Rotation (not logout): links the old token to its successor so a grace window can be granted. */
  async markRotated(id: string, revokedAt: Date, replacedById: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt, replacedById } });
  }
}
