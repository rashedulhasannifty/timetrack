import { describe, it, expect } from 'vitest';
import {
  CSV_COLUMNS,
  csvHeaderLine,
  formatCsvRow,
  neutralizeField,
  escapeField,
  type CsvEntryRow,
} from './csv-writer.js';

const base: CsvEntryRow = {
  entryId: '019797a0-0000-7000-8000-000000000101',
  user: 'Ada',
  project: 'Acme',
  task: 'Build',
  startTime: new Date('2026-07-12T09:00:00.000Z'),
  endTime: new Date('2026-07-12T10:30:00.000Z'),
  durationSeconds: 5400,
  source: 'MANUAL',
  note: 'hello',
};

describe('csv-writer header', () => {
  it('emits the fixed column order terminated by CRLF', () => {
    expect(CSV_COLUMNS).toEqual([
      'entryId',
      'user',
      'project',
      'task',
      'startTime',
      'endTime',
      'durationSeconds',
      'source',
      'note',
    ]);
    expect(csvHeaderLine()).toBe(
      'entryId,user,project,task,startTime,endTime,durationSeconds,source,note\r\n',
    );
  });
});

describe('csv-writer row', () => {
  it('formats a plain row with ISO times and CRLF', () => {
    expect(formatCsvRow(base)).toBe(
      '019797a0-0000-7000-8000-000000000101,Ada,Acme,Build,' +
        '2026-07-12T09:00:00.000Z,2026-07-12T10:30:00.000Z,5400,MANUAL,hello\r\n',
    );
  });

  it('renders null project/task/note and a running entry (empty endTime) as empty fields', () => {
    const row: CsvEntryRow = { ...base, project: null, task: null, note: null, endTime: null };
    expect(formatCsvRow(row)).toBe(
      '019797a0-0000-7000-8000-000000000101,Ada,,,' + '2026-07-12T09:00:00.000Z,,5400,MANUAL,\r\n',
    );
  });
});

describe('escapeField (RFC 4180)', () => {
  it('quotes a field containing a comma', () => {
    expect(escapeField('a,b')).toBe('"a,b"');
  });
  it('quotes and doubles an embedded double-quote', () => {
    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes a field containing CR or LF', () => {
    expect(escapeField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeField('a\r\nb')).toBe('"a\r\nb"');
  });
  it('leaves a plain field untouched', () => {
    expect(escapeField('plain')).toBe('plain');
  });
});

describe('neutralizeField (CSV injection)', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])(
    'prefixes a leading formula trigger with a single quote: %s',
    (v) => {
      expect(neutralizeField(v)).toBe(`'${v}`);
    },
  );
  it('leaves a safe leading character untouched', () => {
    expect(neutralizeField('lunch')).toBe('lunch');
    expect(neutralizeField('')).toBe('');
  });
  it('neutralizes THEN escapes: a leading = plus a comma is both prefixed and quoted', () => {
    // formatCsvRow applies neutralize before escape on text columns.
    const row: CsvEntryRow = { ...base, note: '=1,2' };
    expect(formatCsvRow(row)).toContain(',"\'=1,2"\r\n');
  });
});
