import { describe, it, expect } from 'vitest';
import { ClientHeadersSchema, ClientVersion } from './clients.js';

describe('ClientVersion', () => {
  it('accepts dotted numeric versions', () => {
    for (const v of ['1', '0.6', '0.6.1', '1.2.3.4']) expect(ClientVersion.parse(v)).toBe(v);
  });

  it('rejects suffixes, prefixes, and oversized input', () => {
    for (const v of ['v0.6.1', '0.6.1-pilot', '0.6.', '', '1.2.3.4.5', '12345.0', 'x'.repeat(40)]) {
      expect(ClientVersion.safeParse(v).success).toBe(false);
    }
  });
});

describe('ClientHeadersSchema', () => {
  it('parses a platform and version out of lowercased headers, ignoring the rest', () => {
    const parsed = ClientHeadersSchema.parse({
      'x-client-platform': 'MACOS',
      'x-client-version': '0.7.0',
      authorization: 'Bearer x',
    });
    expect(parsed).toEqual({ 'x-client-platform': 'MACOS', 'x-client-version': '0.7.0' });
  });

  it('rejects an unknown platform', () => {
    const r = ClientHeadersSchema.safeParse({
      'x-client-platform': 'LINUX',
      'x-client-version': '1.0.0',
    });
    expect(r.success).toBe(false);
  });
});
