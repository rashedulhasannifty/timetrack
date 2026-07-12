import { describe, it, expect, afterEach, vi } from 'vitest';
import { api } from './api-client';

afterEach(() => vi.restoreAllMocks());

describe('api.login', () => {
  it('returns the parsed TokenPair on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }), {
            status: 200,
          }),
      ),
    );
    expect(await api.login('user@example.com', 'password12')).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 900,
    });
  });

  it('returns null on 401 (bad credentials) without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('unauthorized', { status: 401 })),
    );
    expect(await api.login('user@example.com', 'wrong')).toBeNull();
  });
});

describe('api.refresh', () => {
  it('returns null when the refresh token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('nope', { status: 401 })),
    );
    expect(await api.refresh('revoked')).toBeNull();
  });
});
