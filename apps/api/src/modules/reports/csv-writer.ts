/**
 * RFC 4180 CSV writer for the time-entry export (slice 3.2). Pure — no Nest/Prisma.
 * Column order lives here as the single source of truth shared by the writer and tests.
 */
export const CSV_COLUMNS = [
  'entryId',
  'user',
  'project',
  'task',
  'startTime',
  'endTime',
  'durationSeconds',
  'source',
  'note',
] as const;

const CRLF = '\r\n';

/** A single exported row. Times are already window-clamped by the repository. */
export interface CsvEntryRow {
  entryId: string;
  user: string;
  project: string | null;
  task: string | null;
  startTime: Date;
  endTime: Date | null; // null → running entry, rendered as an empty field
  durationSeconds: number;
  source: string;
  note: string | null;
}

/**
 * OWASP CSV-injection guard: a text cell that begins with a formula trigger
 * (= + - @, tab, or CR) is prefixed with a single quote so a spreadsheet treats it
 * as text, not a formula. Applied to text columns before RFC-4180 escaping.
 */
export function neutralizeField(value: string): string {
  const first = value.charCodeAt(0);
  // '=' 61, '+' 43, '-' 45, '@' 64, TAB 9, CR 13
  if (first === 61 || first === 43 || first === 45 || first === 64 || first === 9 || first === 13) {
    return `'${value}`;
  }
  return value;
}

/** RFC 4180: wrap in double quotes iff the field contains a comma, quote, CR, or LF. */
export function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const textCell = (value: string | null): string => escapeField(neutralizeField(value ?? ''));

export function csvHeaderLine(): string {
  return CSV_COLUMNS.join(',') + CRLF;
}

export function formatCsvRow(row: CsvEntryRow): string {
  const fields = [
    row.entryId, // UUIDv7 — structurally safe, no neutralize/escape needed
    textCell(row.user),
    textCell(row.project),
    textCell(row.task),
    row.startTime.toISOString(),
    row.endTime ? row.endTime.toISOString() : '',
    String(row.durationSeconds),
    row.source, // enum — safe
    textCell(row.note),
  ];
  return fields.join(',') + CRLF;
}
