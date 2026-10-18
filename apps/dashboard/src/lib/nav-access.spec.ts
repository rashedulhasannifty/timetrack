import { describe, it, expect } from 'vitest';
import type { Role } from '@timetrack/contracts';
import { canSee, landingPathFor, sectionsFor } from './nav-access';

describe('sectionsFor', () => {
  it('gives an EMPLOYEE only their own time and the install guide', () => {
    expect(sectionsFor('EMPLOYEE')).toEqual(['me', 'install']);
  });

  it('gives a MANAGER the team surfaces but not Admin', () => {
    expect(sectionsFor('MANAGER')).toEqual([
      'overview',
      'projects',
      'reports',
      'approvals',
      'me',
      'install',
    ]);
  });

  it('gives an ADMIN every section', () => {
    expect(sectionsFor('ADMIN')).toEqual([
      'overview',
      'projects',
      'reports',
      'approvals',
      'admin',
      'me',
      'install',
    ]);
  });

  it('canSee agrees with sectionsFor', () => {
    expect(canSee('EMPLOYEE', 'overview')).toBe(false);
    expect(canSee('MANAGER', 'admin')).toBe(false);
    expect(canSee('ADMIN', 'admin')).toBe(true);
  });
});

describe('landingPathFor', () => {
  const cases: [Role, string][] = [
    ['EMPLOYEE', '/me'],
    ['MANAGER', '/overview'],
    ['ADMIN', '/overview'],
  ];
  it.each(cases)('%s lands on %s', (role, path) => {
    expect(landingPathFor(role)).toBe(path);
  });

  it('falls back to /me — the one page every role can open — when the role is unknown', () => {
    expect(landingPathFor(null)).toBe('/me');
    expect(landingPathFor(undefined)).toBe('/me');
  });
});
