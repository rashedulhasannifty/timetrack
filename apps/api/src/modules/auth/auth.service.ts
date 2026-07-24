import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type {
  AcceptInvite,
  JwtClaims,
  Login,
  OidcAuthorizeResult,
  OidcCallback,
  Refresh,
  TokenPair,
} from '@timetrack/contracts';
import { loadEnv, oidcConfig } from '@timetrack/config';
import { InvitesService } from '../invites/invites.service.js';
import {
  AuthRepository,
  SsoConcurrentCreateError,
  SsoTeamMissingError,
  type AuthIdentity,
} from './auth.repository.js';
import { OidcService, type OidcIdentity } from './oidc.service.js';
import { durationToSeconds } from './token.util.js';

/** The OIDC provider tag stored on a linked/provisioned user. Slice 4.4 is OIDC-only. */
const SSO_PROVIDER = 'oidc';

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
    private readonly oidc: OidcService,
  ) {}

  async acceptInvite(dto: AcceptInvite): Promise<TokenPair> {
    const { userId, role, teamId } = await this.invites.accept(dto.token, dto.password);
    return (await this.issueTokens({ id: userId, role, teamId, deactivatedAt: null })).tokens;
  }

  async login(dto: Login): Promise<TokenPair> {
    const user = await this.repo.findByEmail(dto.email);
    // A null passwordHash is an SSO-only account: it has no password, so the password path
    // must reject it — and must do so BEFORE argon2.verify (which throws on a null hash).
    if (!user || user.deactivatedAt || user.passwordHash === null) {
      // Burn comparable time so a missing/disabled/SSO-only account is indistinguishable by timing.
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

  /**
   * PRD §6.8 (slice 4.4) — start the OIDC flow. The dashboard stores the returned secrets in
   * a short cookie and redirects the browser to `authorizationUrl`. 404 when SSO is off so
   * the endpoint reads as absent (the dashboard also hides the button).
   */
  async oidcAuthorize(): Promise<OidcAuthorizeResult> {
    if (!this.oidc.isEnabled()) throw this.ssoDisabled();
    return this.oidc.authorize();
  }

  /**
   * PRD §6.8 (slice 4.4) — finish the OIDC flow: verify the callback with the IdP, resolve
   * (link/provision) the User, and issue the same TokenPair as password login.
   */
  async oidcCallback(dto: OidcCallback): Promise<TokenPair> {
    if (!this.oidc.isEnabled()) throw this.ssoDisabled();
    const identity = await this.oidc.verifyCallback(dto);
    const user = await this.resolveSsoUser(identity);
    return (await this.issueTokens(user)).tokens;
  }

  /**
   * Map a verified IdP identity to a User. Match order matters for security:
   *  1. by stable (provider, subject) — the only branch that bypasses the email-verified gate.
   *  2. FAIL-CLOSED email gate — an unverified (or absent) email must never link or provision,
   *     or an IdP emitting `admin@company.com` unverified would be account takeover.
   *  3. by email → LINK an existing user.
   *  4. else auto-provision into the default team as an EMPLOYEE.
   */
  private async resolveSsoUser(identity: OidcIdentity): Promise<AuthIdentity> {
    const bySubject = await this.repo.findBySsoIdentity(SSO_PROVIDER, identity.sub);
    if (bySubject) return this.assertActive(bySubject);

    if (!identity.emailVerified) throw this.emailNotVerified();

    const linked = await this.linkByEmail(identity);
    if (linked) return linked;

    const cfg = oidcConfig(this.env);
    if (!cfg) throw this.ssoDisabled(); // unreachable once isEnabled() passed; keeps types honest
    const name = identity.name ?? identity.email.split('@')[0] ?? identity.email;
    try {
      return await this.repo.createSsoUser({
        email: identity.email,
        name,
        teamId: cfg.defaultTeamId,
        ssoProvider: SSO_PROVIDER,
        ssoSubject: identity.sub,
      });
    } catch (err) {
      if (err instanceof SsoTeamMissingError) {
        throw new ServiceUnavailableException({
          type: 'https://timetrack.internal/errors/sso-misconfigured',
          title: 'SSO is misconfigured',
          status: 503,
        });
      }
      if (err instanceof SsoConcurrentCreateError) {
        // A concurrent first login won the create — resolve to the winner's row rather than
        // 500. Try the subject it just wrote, then fall back to linking by email.
        const raced = await this.repo.findBySsoIdentity(SSO_PROVIDER, identity.sub);
        if (raced) return this.assertActive(raced);
        const relinked = await this.linkByEmail(identity);
        if (relinked) return relinked;
      }
      throw err;
    }
  }

  /** Link a verified identity to an existing user matched by email, or null if none. */
  private async linkByEmail(identity: OidcIdentity): Promise<AuthIdentity | null> {
    const byEmail = await this.repo.findIdentityByEmail(identity.email);
    if (!byEmail) return null;
    const active = this.assertActive(byEmail);
    await this.repo.linkSso(active.id, SSO_PROVIDER, identity.sub);
    return active;
  }

  private assertActive(identity: AuthIdentity): AuthIdentity {
    if (identity.deactivatedAt) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/account-deactivated',
        title: 'Your account has been deactivated',
        status: 403,
      });
    }
    return identity;
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

  /** SSO is off → the OIDC routes read as absent (404), matching the hidden dashboard button. */
  private ssoDisabled(): NotFoundException {
    return new NotFoundException({
      type: 'https://timetrack.internal/errors/not-found',
      title: 'Not found',
      status: 404,
    });
  }

  private emailNotVerified(): ForbiddenException {
    return new ForbiddenException({
      type: 'https://timetrack.internal/errors/sso-email-unverified',
      title: 'Your identity provider has not verified this email address',
      status: 403,
    });
  }
}
