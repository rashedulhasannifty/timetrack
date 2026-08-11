import { describe, it, expect } from 'vitest';
import { seeOther } from './redirect';

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
