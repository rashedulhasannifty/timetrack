import { Injectable, NotImplementedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Login, Refresh, TokenPair } from '@timetrack/contracts';
import { AuthRepository } from './auth.repository.js';

/**
 * SCAFFOLD. The token-issuing seam is wired (JwtService is injected and the guards
 * already verify what this signs), but the credential + refresh-token flow is not
 * implemented. Implement in this order, each with a regression test (CLAUDE.md §5):
 *
 *   1. login:   look up user by email (repo) → argon2.verify(passwordHash, password)
 *               → sign access JWT { sub, role, teamId } → mint + persist a hashed,
 *               rotating refresh token (PRD §6.8). Reject deactivated users.
 *   2. refresh: verify the presented refresh token against its stored hash, rotate it
 *               (single-use), issue a fresh access token.
 *   3. logout:  revoke the presented refresh token for this device.
 *
 * Argon2id (PRD §6.8) — never bcrypt. Refresh tokens are hashed at rest and revocable
 * per device. Nothing here logs a password, token, or hash (packages/logger redacts).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly repo: AuthRepository,
  ) {}

  login(_dto: Login): Promise<TokenPair> {
    // TODO(scaffold): argon2 verify + issue token pair. See class doc.
    void this.jwt;
    void this.repo;
    throw new NotImplementedException('auth.login not yet implemented');
  }

  refresh(_dto: Refresh): Promise<TokenPair> {
    // TODO(scaffold): verify + rotate refresh token.
    throw new NotImplementedException('auth.refresh not yet implemented');
  }

  logout(_dto: Refresh): Promise<void> {
    // TODO(scaffold): revoke refresh token for this device.
    throw new NotImplementedException('auth.logout not yet implemented');
  }
}
