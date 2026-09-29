import { describe, expect, it } from 'vitest';
import { planNameImport } from './name-import.js';

describe('planNameImport', () => {
  it('normalizes each name and accepts the new ones in order', () => {
    expect(planNameImport(['  Acme  Ltd ', 'Globex'], new Map())).toEqual({
      accepted: ['Acme Ltd', 'Globex'],
      skipped: [],
    });
  });

  it('skips a taken name with the reason the caller supplied', () => {
    const taken = new Map([['acme', 'Already exists in Support']]);
    expect(planNameImport(['ACME'], taken).skipped).toEqual([
      { name: 'ACME', reason: 'Already exists in Support' },
    ]);
  });

  it('skips in-list repeats case-insensitively, keeping the first spelling', () => {
    expect(planNameImport(['Globex', 'globex', 'GLOBEX'], new Map())).toEqual({
      accepted: ['Globex'],
      skipped: [
        { name: 'globex', reason: 'Duplicate in list' },
        { name: 'GLOBEX', reason: 'Duplicate in list' },
      ],
    });
  });

  it('skips empty and over-long names instead of failing the batch', () => {
    const long = 'x'.repeat(201);
    expect(planNameImport(['   ', '&nbsp;', long, 'Ok'], new Map())).toEqual({
      accepted: ['Ok'],
      skipped: [
        { name: '   ', reason: 'Empty name' },
        { name: '&nbsp;', reason: 'Empty name' },
        { name: long, reason: 'Longer than 200 characters' },
      ],
    });
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(planNameImport(['y'.repeat(200)], new Map()).accepted).toHaveLength(1);
  });
});
