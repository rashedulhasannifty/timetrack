import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { JwtClaims, Login, Refresh, TokenPair } from '@timetrack/contracts';
import { loadEnv } from '@timetrack/config';
import { AuthRepository, type AuthIdentity } from './auth.repository.js';
import { durationToSeconds } from './token.util.js';

/**
 * PRD §6.8 — email/password auth.
 * - Passwords: Argon2id (never bcrypt). Verified in constant time by argon2.
 * - Access token: short-lived JWT { sub, role, teamId } signed with JWT_ACCESS_SECRET
 *   (the same secret JwtAuthGuard verifies), expiry from the JwtModule config.
 * - Refresh token: an opaque 256-bit random string (fully revocable), stored only as an
 *   HMAC keyed by JWT_REFRESH_SECRET — a DB leak alone cannot forge a lookup. Single-use:
 *   a refresh revokes the presented token and issues a fresh pair (rotation).
 *
 * Nothing here logs a password, hash, or token; packages/logger also redacts them.
 */
@Injectable()
export class AuthService {
  private readonly env = loadEnv();
  private readonly accessTtlSeconds = durationToSeconds(this.env.ACCESS_TOKEN_TTL);
  private readonly refreshTtlSeconds = durationToSeconds(this.env.REFRESH_TOKEN_TTL);

  constructor(
    private readonly jwt: JwtService,
    private readonly repo: AuthRepository,
  ) {}

  async login(dto: Login): Promise<TokenPair> {
    const user = await this.repo.findByEmail(dto.email);
    if (!user || user.deactivatedAt) {
      // Burn comparable time so a missing/disabled account is indistinguishable by timing.
      await argon2.hash(dto.password, { type: argon2.argon2id }).catch(() => undefined);
      throw this.invalidCredentials();
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw this.invalidCredentials();
    return this.issueTokens({
      id: user.id,
      role: user.role,
      teamId: user.teamId,
      deactivatedAt: user.deactivatedAt,
    });
  }

  async refresh(dto: Refresh): Promise<TokenPair> {
    const stored = await this.repo.findRefreshToken(this.hashRefreshToken(dto.refreshToken));
    const now = new Date();
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= now.getTime()) {
      throw this.invalidToken();
    }
    // Single-use rotation: revoke before issuing, so a replayed token cannot be reused.
    await this.repo.revokeRefreshToken(stored.id, now);
    const identity = await this.repo.findIdentityById(stored.userId);
    if (!identity || identity.deactivatedAt) throw this.invalidToken();
    return this.issueTokens(identity);
  }

  async logout(dto: Refresh): Promise<void> {
    const stored = await this.repo.findRefreshToken(this.hashRefreshToken(dto.refreshToken));
    if (stored && !stored.revokedAt) {
      await this.repo.revokeRefreshToken(stored.id, new Date());
    }
    // Idempotent: an unknown or already-revoked token is a no-op, never an error.
  }

  private async issueTokens(identity: AuthIdentity): Promise<TokenPair> {
    const claims: JwtClaims = { sub: identity.id, role: identity.role, teamId: identity.teamId };
    const accessToken = await this.jwt.signAsync(claims);

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);
    await this.repo.createRefreshToken(identity.id, this.hashRefreshToken(refreshToken), expiresAt);

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }

  /** HMAC (not a plain hash) so the stored value is useless without JWT_REFRESH_SECRET. */
  private hashRefreshToken(token: string): string {
    return createHmac('sha256', this.env.JWT_REFRESH_SECRET).update(token).digest('hex');
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      type: 'https://timetrack.internal/errors/invalid-credentials',
      title: 'Invalid email or password',
      status: 401,
    });
  }

  private invalidToken(): UnauthorizedException {
    return new UnauthorizedException({
      type: 'https://timetrack.internal/errors/invalid-refresh-token',
      title: 'Invalid or expired refresh token',
      status: 401,
    });
  }
}
