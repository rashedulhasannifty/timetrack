import { describe, it, expect } from 'vitest';
import { initialsFor, avatarColors, AVATAR_PALETTE } from './avatar';

describe('initialsFor', () => {
  it('takes first+last initials for multi-word names', () => {
    expect(initialsFor('John Doe')).toBe('JD');
    expect(initialsFor('  mary  jane  watson ')).toBe('MW');
  });
  it('takes up to two letters for a single name', () => {
    expect(initialsFor('Ann')).toBe('AN');
    expect(initialsFor('x')).toBe('X');
  });
  it('falls back to ? for empty input', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('avatarColors', () => {
  it('is deterministic per name', () => {
    expect(avatarColors('John Doe')).toEqual(avatarColors('John Doe'));
  });
  it('always returns a palette pair', () => {
    const c = avatarColors('Zoe Q');
    expect(AVATAR_PALETTE).toContainEqual(c);
  });
});
