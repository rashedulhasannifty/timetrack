import { describe, expect, it } from 'vitest';
import {
  ImportNameSchema,
  NAME_MAX_LENGTH,
  NameSkipSchema,
  nameKey,
  normalizeName,
  parseNameList,
} from './name-list.js';

/** Exactly what an admin pasted from the old tool, table borders, header lines, entities and all. */
const PASTED = ` Sub-Project — 12 options

  Bookkeeping · Clean Up &&nbsp; Catch Up · Audit Assist · Payroll · VAT/TAX Filling · Process Development · AdHoc · Internal · R&D · Software Development
  · Automation · Client Communication

  Client — 98 options

  ┌─────────────────────────┬────────────────────────────┬────────────────────────────┐
  │                         │                            │                            │
  ├─────────────────────────┼────────────────────────────┼────────────────────────────┤
  │ Arcade Gamer            │ Biz Trading                │ Brooklyn Booys             │
  ├─────────────────────────┼────────────────────────────┼────────────────────────────┤
  │ Chris Waterguy          │ EcoTrade                   │ TNL / JM Social / Natropia │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ Creative Food&nbsp; lab │ Austro Media                  │ Mary Myatt                 │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ ITR/STTR/CTR            │ Nifty AI                      │ Energy Reporting           │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ Nifty Engineering       │ chineseshop.bd                │`;

describe('parseNameList', () => {
  it('turns the literal pasted table into clean names, in order', () => {
    // The two header lines survive as names on purpose (plan ruling R2): the preview shows
    // them and the admin deletes them. Borders, empty cells and `·` separators all vanish.
    expect(parseNameList(PASTED)).toEqual([
      'Sub-Project — 12 options',
      'Bookkeeping',
      'Clean Up & Catch Up',
      'Audit Assist',
      'Payroll',
      'VAT/TAX Filling',
      'Process Development',
      'AdHoc',
      'Internal',
      'R&D',
      'Software Development',
      'Automation',
      'Client Communication',
      'Client — 98 options',
      'Arcade Gamer',
      'Biz Trading',
      'Brooklyn Booys',
      'Chris Waterguy',
      'EcoTrade',
      'TNL / JM Social / Natropia',
      'Creative Food lab',
      'Austro Media',
      'Mary Myatt',
      'ITR/STTR/CTR',
      'Nifty AI',
      'Energy Reporting',
      'Nifty Engineering',
      'chineseshop.bd',
    ]);
  });

  it('decodes &nbsp; and folds the stray & before it into one plain &', () => {
    expect(parseNameList('Clean Up &&nbsp; Catch Up')).toEqual(['Clean Up & Catch Up']);
    expect(parseNameList('Creative Food&nbsp; lab')).toEqual(['Creative Food lab']);
  });

  it('decodes the named and numeric entities the spec lists', () => {
    expect(parseNameList('A &amp; B\n&lt;x&gt;\n&quot;q&quot;\nO&#39;Brien\n&#x41;&#66;')).toEqual([
      'A & B',
      '<x>',
      '"q"',
      "O'Brien",
      'AB',
    ]);
  });

  it('leaves unknown and out-of-range entities verbatim', () => {
    expect(parseNameList('Copy &copy; Ltd\nZero &#0;\nHuge &#99999999;')).toEqual([
      'Copy &copy; Ltd',
      'Zero &#0;',
      'Huge &#99999999;',
    ]);
  });

  it('treats U+00A0 as a space', () => {
    expect(parseNameList('Nifty\u00a0\u00a0AI')).toEqual(['Nifty AI']);
  });

  it('splits on newlines of every kind, tabs, box columns and ASCII pipes', () => {
    expect(parseNameList('A\r\nB\rC\tD │ E | F')).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('splits on a spaced middle dot, including one at the start or end of a line (ruling R1)', () => {
    expect(parseNameList('Payroll · Audit\n· Automation\nInternal ·')).toEqual([
      'Payroll',
      'Audit',
      'Automation',
      'Internal',
    ]);
  });

  it('does not split on a middle dot inside a word', () => {
    expect(parseNameList('Caf·Bar')).toEqual(['Caf·Bar']);
  });

  it('drops runs made only of box-drawing characters, spaces or dashes', () => {
    expect(parseNameList('┌──┬──┐\n----\n – — \nReal')).toEqual(['Real']);
  });

  it('keeps names with slashes and commas whole', () => {
    expect(parseNameList('ITR/STTR/CTR\nSellcrowd Technology Ltd.\nSmith, Jones & Co')).toEqual([
      'ITR/STTR/CTR',
      'Sellcrowd Technology Ltd.',
      'Smith, Jones & Co',
    ]);
  });

  it('trims, collapses internal whitespace and drops empties', () => {
    expect(parseNameList('   Biz    Trading   \n\n   \n')).toEqual(['Biz Trading']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseNameList('Payroll\nPAYROLL\npayroll\nAudit')).toEqual(['Payroll', 'Audit']);
  });

  it('returns nothing for empty input', () => {
    expect(parseNameList('')).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('decodes, treats NBSP as space, collapses and trims a single name', () => {
    expect(normalizeName('  Clean Up &&nbsp;\u00a0Catch   Up ')).toBe('Clean Up & Catch Up');
  });

  it('does not split — a pipe or dot inside a single name stays', () => {
    expect(normalizeName('A | B · C')).toBe('A | B · C');
  });
});

describe('nameKey', () => {
  it('compares names case-insensitively', () => {
    expect(nameKey('Payroll')).toBe(nameKey('PAYROLL'));
  });
});

describe('import schemas', () => {
  it('caps a raw import name at 1000 characters', () => {
    expect(ImportNameSchema.safeParse('x'.repeat(1000)).success).toBe(true);
    expect(ImportNameSchema.safeParse('x'.repeat(1001)).success).toBe(false);
  });

  it('exposes the 200-character single-name limit', () => {
    expect(NAME_MAX_LENGTH).toBe(200);
  });

  it('parses a skip row', () => {
    expect(NameSkipSchema.parse({ name: 'A', reason: 'Duplicate in list' })).toEqual({
      name: 'A',
      reason: 'Duplicate in list',
    });
  });
});
