import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { AcceptInvite, JwtClaims, Login, Refresh, TokenPair } from '@timetrack/contracts';
import { loadEnv } from '@timetrack/config';
import { InvitesService } from '../invites/invites.service.js';
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
  private readonly refreshGraceSeconds = this.env.REFRESH_GRACE_SECONDS;

  constructor(
    private readonly jwt: JwtService,
    private readonly repo: AuthRepository,
    private readonly invites: InvitesService,
  ) {}

  async acceptInvite(dto: AcceptInvite): Promise<TokenPair> {
    const { userId, role, teamId } = await this.invites.accept(dto.token, dto.password);
    return (await this.issueTokens({ id: userId, role, teamId, deactivatedAt: null })).tokens;
  }

  async login(dto: Login): Promise<TokenPair> {
    const user = await this.repo.findByEmail(dto.email);
    if (!user || user.deactivatedAt) {
      // Burn comparable time so a missing/disabled account is indistinguishable by timing.
      await argon2.hash(dto.password, { type: argon2.argon2id }).catch(() => undefined);
      throw this.invalidCredentials();
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw this.invalidCredentials();
    return (
      await this.issueTokens({
        id: user.id,
        role: user.role,
        teamId: user.teamId,
        deactivatedAt: user.deactivatedAt,
      })
    ).tokens;
  }

  async refresh(dto: Refresh): Promise<TokenPair> {
    const stored = await this.repo.findRefreshToken(this.hashRefreshToken(dto.refreshToken));
    const now = new Date();
    if (!stored || stored.expiresAt.getTime() <= now.getTime()) throw this.invalidToken();

    if (stored.revokedAt) {
      // A revoked token is acceptable ONLY if it was rotated (has a successor) recently —
      // the multi-tab race. A logout-revoked token (replacedById null) is never graced.
      const graceMs = this.refreshGraceSeconds * 1000;
      const withinGrace = now.getTime() - stored.revokedAt.getTime() <= graceMs;
      if (!stored.replacedById || !withinGrace) throw this.invalidToken();
    }

    const identity = await this.repo.findIdentityById(stored.userId);
    if (!identity || identity.deactivatedAt) throw this.invalidToken();

    const issued = await this.issueTokens(identity);
    // Only the first (normal) rotation links the old token → successor; the grace path
    // leaves the original revokedAt/replacedById intact so the window doesn't slide.
    if (!stored.revokedAt) {
      await this.repo.markRotated(stored.id, now, issued.refreshTokenId);
    }
    return issued.tokens;
  }

  async logout(dto: Refresh): Promise<void> {
    const stored = await this.repo.findRefreshToken(this.hashRefreshToken(dto.refreshToken));
    if (stored && !stored.revokedAt) {
      await this.repo.revokeRefreshToken(stored.id, new Date());
    }
    // Idempotent: an unknown or already-revoked token is a no-op, never an error.
  }

  private async issueTokens(
    identity: AuthIdentity,
  ): Promise<{ tokens: TokenPair; refreshTokenId: string }> {
    const claims: JwtClaims = { sub: identity.id, role: identity.role, teamId: identity.teamId };
    const accessToken = await this.jwt.signAsync(claims);

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);
    const refreshTokenId = await this.repo.createRefreshToken(
      identity.id,
      this.hashRefreshToken(refreshToken),
      expiresAt,
    );

    return {
      tokens: { accessToken, refreshToken, expiresIn: this.accessTtlSeconds },
      refreshTokenId,
    };
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
