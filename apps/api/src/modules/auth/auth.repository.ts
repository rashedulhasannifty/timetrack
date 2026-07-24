import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { Role } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface AuthUser {
  id: string;
  email: string;
  /** Null for SSO-only users — the service rejects a null-hash password login. */
  passwordHash: string | null;
  role: Role;
  teamId: string;
  deactivatedAt: Date | null;
}

export interface ProvisionSsoUser {
  email: string;
  name: string;
  teamId: string;
  ssoProvider: string;
  ssoSubject: string;
}

/**
 * Raised when SSO provisioning cannot place a user because OIDC_DEFAULT_TEAM_ID does not
 * resolve to a team (Prisma P2003 FK violation). Kept as a plain domain error so the
 * repository owns Prisma while the service owns the HTTP mapping (→ 503).
 */
export class SsoTeamMissingError extends Error {}

/**
 * Raised when two concurrent first logins for the same new identity race to create the User
 * and the loser hits the `email` unique constraint (P2002). The service re-resolves to the
 * winner's row instead of surfacing a 500 (mirrors the invites repo's P2002 discipline).
 */
export class SsoConcurrentCreateError extends Error {}

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

  /** Match an SSO user by its stable IdP (provider, subject) — the trusted identity key. */
  findBySsoIdentity(ssoProvider: string, ssoSubject: string): Promise<AuthIdentity | null> {
    return this.prisma.user.findUnique({
      where: { ssoProvider_ssoSubject: { ssoProvider, ssoSubject } },
      select: { id: true, role: true, teamId: true, deactivatedAt: true },
    });
  }

  /** Match by email to LINK an existing (password) user to an SSO identity. */
  findIdentityByEmail(email: string): Promise<AuthIdentity | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, teamId: true, deactivatedAt: true },
    });
  }

  /** Backfill the SSO identity onto an existing user (idempotent link). */
  async linkSso(userId: string, ssoProvider: string, ssoSubject: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { ssoProvider, ssoSubject },
    });
  }

  /**
   * Auto-provision a brand-new SSO user (no password). A P2003 means OIDC_DEFAULT_TEAM_ID
   * points at a non-existent team — surfaced as a typed domain error for the service to map.
   */
  async createSsoUser(input: ProvisionSsoUser): Promise<AuthIdentity> {
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          teamId: input.teamId,
          ssoProvider: input.ssoProvider,
          ssoSubject: input.ssoSubject,
        },
        select: { id: true, role: true, teamId: true, deactivatedAt: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003') throw new SsoTeamMissingError();
        if (err.code === 'P2002') throw new SsoConcurrentCreateError();
      }
      throw err;
    }
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
