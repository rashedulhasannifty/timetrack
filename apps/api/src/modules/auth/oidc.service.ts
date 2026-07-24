import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { loadEnv, oidcConfig, type OidcConfig } from '@timetrack/config';
import type { OidcAuthorizeResult, OidcCallback } from '@timetrack/contracts';

/**
 * The identity a verified OIDC callback resolves to. `sub` is the IdP's stable subject
 * identifier; `emailVerified` reflects the ID token's `email_verified` claim (absent ⇒
 * false — the caller fails closed on it).
 */
export interface OidcIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

// openid-client is ESM-only (Prisma-style require(esm) also works under Node 24, but a
// dynamic import is type-clean under NodeNext for a CJS build). Typed via the import type.
type OidcModule = typeof import('openid-client');
type OidcConfiguration = Awaited<ReturnType<OidcModule['discovery']>>;

/**
 * PRD §6.8 (slice 4.4) — the ONLY place the OIDC protocol/crypto lives. Wraps
 * `openid-client`: discovery, PKCE, state/nonce, code exchange, and ID-token verification.
 * The IdP client secret never leaves this process. The dashboard BFF calls the auth
 * controller, which calls this — the browser never talks to the IdP directly.
 *
 * Nothing here is logged; tokens and the client secret must never reach Pino.
 */
@Injectable()
export class OidcService {
  private readonly env = loadEnv();
  private readonly config: OidcConfig | null = oidcConfig(this.env);

  private modPromise: Promise<OidcModule> | undefined;
  // Memoized ONLY on success — a rejected discovery (IdP briefly down) must not be cached,
  // or a transient outage would permanently disable SSO until restart.
  private discoveryPromise: Promise<OidcConfiguration> | undefined;

  /** SSO is enabled iff every OIDC_* var is set (config helper enforces all-or-nothing). */
  isEnabled(): boolean {
    return this.config !== null;
  }

  /** Mint a fresh PKCE verifier + state + nonce and the IdP authorization URL. */
  async authorize(): Promise<OidcAuthorizeResult> {
    const cfg = this.requireConfig();
    const client = await this.module();
    const discovery = await this.discover();

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const url = client.buildAuthorizationUrl(discovery, {
      redirect_uri: cfg.redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    return { authorizationUrl: url.href, state, nonce, codeVerifier };
  }

  /**
   * Exchange the authorization code and verify the ID token (issuer, audience, signature via
   * JWKS, and the expected state + nonce bound to the request that started the flow). Any
   * failure — bad code, mismatched state/nonce, invalid signature — is a 401, never a 500.
   */
  async verifyCallback(dto: OidcCallback): Promise<OidcIdentity> {
    const cfg = this.requireConfig();
    const client = await this.module();
    const discovery = await this.discover();

    // authorizationCodeGrant reads `code` + `state` from a URL; the dashboard delivered them
    // as a body, so reconstruct the redirect URL it would have seen.
    const currentUrl = new URL(cfg.redirectUri);
    currentUrl.searchParams.set('code', dto.code);
    currentUrl.searchParams.set('state', dto.state);

    let claims: Record<string, unknown> | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(discovery, currentUrl, {
        pkceCodeVerifier: dto.codeVerifier,
        expectedState: dto.state,
        expectedNonce: dto.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch {
      // Never surface openid-client internals (they can carry token-endpoint response bodies).
      throw this.invalidCallback();
    }

    if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw this.invalidCallback();
    }
    const email = typeof claims.email === 'string' ? claims.email : '';
    if (email.length === 0) throw this.invalidCallback();

    return {
      sub: claims.sub,
      email,
      // Fail closed: an absent or non-true `email_verified` claim is treated as unverified.
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' && claims.name.length > 0 ? claims.name : null,
    };
  }

  private requireConfig(): OidcConfig {
    if (this.config === null) {
      // Should be unreachable — the controller/service gate on isEnabled() first — but keep
      // the invariant local so this service can never run half-configured.
      throw new ServiceUnavailableException({
        type: 'https://timetrack.internal/errors/sso-not-configured',
        title: 'SSO is not configured',
        status: 503,
      });
    }
    return this.config;
  }

  private async module(): Promise<OidcModule> {
    this.modPromise ??= import('openid-client');
    return this.modPromise;
  }

  private async discover(): Promise<OidcConfiguration> {
    if (this.discoveryPromise) return this.discoveryPromise;
    const cfg = this.requireConfig();
    const client = await this.module();
    // Production requires HTTPS to the IdP. Outside production, allow http:// so a local IdP
    // (Keycloak on localhost) and the e2e stub work — never in production.
    const options =
      this.env.NODE_ENV === 'production' ? undefined : { execute: [client.allowInsecureRequests] };
    const promise = client.discovery(
      new URL(cfg.issuer),
      cfg.clientId,
      cfg.clientSecret,
      undefined,
      options,
    );
    // Cache only once it resolves, so a transient discovery failure is retryable.
    this.discoveryPromise = promise;
    try {
      await promise;
    } catch {
      this.discoveryPromise = undefined;
      throw new ServiceUnavailableException({
        type: 'https://timetrack.internal/errors/sso-unavailable',
        title: 'SSO provider is unavailable',
        status: 503,
      });
    }
    return promise;
  }

  private invalidCallback(): UnauthorizedException {
    return new UnauthorizedException({
      type: 'https://timetrack.internal/errors/invalid-sso-callback',
      title: 'SSO sign-in could not be verified',
      status: 401,
    });
  }
}
