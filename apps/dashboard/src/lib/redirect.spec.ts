import { describe, it, expect } from 'vitest';
import { safeInternalPath, refreshBackTo, seeOther } from './redirect';

describe('seeOther', () => {
  it('emits a 303 with the path as given', () => {
    const res = seeOther('/login');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('never emits an absolute URL', () => {
    // The regression: deriving an origin from req.url yielded https://localhost:3000/login
    // behind the reverse proxy, so every browser redirect left the site.
    for (const path of ['/', '/login', '/login?error=1', '/accept-invite?token=abc']) {
      expect(seeOther(path).headers.get('location')).not.toMatch(/^[a-z]+:\/\//);
    }
  });

  it('preserves the query string', () => {
    expect(seeOther('/login?error=sso').headers.get('location')).toBe('/login?error=sso');
  });

  it('still supports attaching cookies — the auth routes set the session on it', () => {
    const res = seeOther('/');
    res.cookies.set('tt_session', 'value');
    expect(res.cookies.get('tt_session')?.value).toBe('value');
  });
});

describe('safeInternalPath', () => {
  it('accepts an ordinary internal path', () => {
    expect(safeInternalPath('/admin/settings')).toBe('/admin/settings');
    expect(safeInternalPath('/reports?from=2026-08-01')).toBe('/reports?from=2026-08-01');
  });

  it('rejects anything that could leave the origin', () => {
    // `//evil.test` is protocol-relative — a browser resolves it as a cross-origin URL, so it
    // would turn the one route that hands out a fresh session into an open redirect.
    expect(safeInternalPath('//evil.test')).toBeNull();
    expect(safeInternalPath('https://evil.test')).toBeNull();
    expect(safeInternalPath('/\\evil.test')).toBeNull();
    expect(safeInternalPath('evil.test')).toBeNull();
    expect(safeInternalPath('')).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
  });

  it('refuses to bounce back into the auth routes (loop-breaker)', () => {
    expect(safeInternalPath('/api/auth/refresh')).toBeNull();
  });

  it('refreshBackTo encodes the destination', () => {
    expect(refreshBackTo('/people/abc?date=2026-08-24')).toBe(
      '/api/auth/refresh?next=%2Fpeople%2Fabc%3Fdate%3D2026-08-24',
    );
  });
});
