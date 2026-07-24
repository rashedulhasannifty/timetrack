import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * A minimal in-process OIDC identity provider for the OIDC e2e: it serves real discovery
 * metadata, a JWKS, and a token endpoint that returns a properly RS256-signed ID token — so
 * the tests exercise the REAL `openid-client` verification (signature, issuer, audience,
 * nonce), not a mock. The desired ID-token claims are carried in the `code` the test crafts
 * (a base64url JSON blob), since this stub never sees the browser authorization request.
 */
export interface FakeIdpClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  /** Must equal the nonce minted by `authorize()`; a wrong value exercises nonce rejection. */
  nonce: string;
}

export interface FakeIdp {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Encode the ID-token claims the /token endpoint should mint for this login. */
  makeCode(claims: FakeIdpClaims): string;
  close(): Promise<void>;
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

function signIdToken(claims: Record<string, unknown>, privateKey: KeyObject, kid: string): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), privateKey); // RSA → RS256
  return `${signingInput}.${b64url(signature)}`;
}

export async function startFakeIdp(): Promise<FakeIdp> {
  const clientId = 'test-client';
  const clientSecret = 'test-client-secret';
  const kid = 'test-key-1';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };

  let issuer = '';

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        grant_types_supported: ['authorization_code'],
        scopes_supported: ['openid', 'email', 'profile'],
        claims_supported: ['sub', 'email', 'email_verified', 'name'],
        code_challenge_methods_supported: ['S256'],
      });
      return;
    }

    if (url.pathname === '/jwks') {
      json({ keys: [jwk] });
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const code = new URLSearchParams(raw).get('code') ?? '';
        let claims: FakeIdpClaims;
        try {
          claims = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as FakeIdpClaims;
        } catch {
          res.writeHead(400).end('{"error":"invalid_grant"}');
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const idToken = signIdToken(
          {
            iss: issuer,
            aud: clientId,
            azp: clientId,
            sub: claims.sub,
            email: claims.email,
            email_verified: claims.email_verified,
            ...(claims.name !== undefined ? { name: claims.name } : {}),
            nonce: claims.nonce,
            iat: now,
            exp: now + 300,
          },
          privateKey,
          kid,
        );
        json({
          access_token: 'fake-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid email profile',
          id_token: idToken,
        });
      });
      return;
    }

    res.writeHead(404).end('{"error":"not_found"}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    makeCode: (claims) => b64url(JSON.stringify(claims)),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
