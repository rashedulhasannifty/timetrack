import { z } from 'zod';

/** The longest single client or work-type name (matches CreateProjectSchema's 200). */
export const NAME_MAX_LENGTH = 200;

/**
 * One raw name as it arrives in a bulk request. Bounded so a runaway paste cannot balloon the
 * payload, but deliberately looser than NAME_MAX_LENGTH: an over-long line is reported back as a
 * skip with a reason instead of 422-ing the other 97 names (plan ruling R4).
 */
export const ImportNameSchema = z.string().max(1000);

/** A name a bulk import did not create, and why. */
export const NameSkipSchema = z.object({ name: z.string(), reason: z.string() });
export type NameSkip = z.infer<typeof NameSkipSchema>;

// Only the entities the spec names; anything else is left verbatim (plan ruling R3).
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
};
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;

// Table columns: tab, ASCII pipe, and the box-drawing vertical │ — exactly the spec's (R18).
const COLUMN_SEPARATOR = /[\t|\u2502]/;
// A middle dot standing alone: whitespace or a line edge on both sides (plan ruling R1).
const MIDDLE_DOT_SEPARATOR = /(?:^|\s)\u00b7(?=\s|$)/;
// A run made only of box-drawing characters, whitespace or dashes (also matches the empty string).
const BORDER_ONLY = /^[\u2500-\u257f\s\-\u2013\u2014]*$/;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole: string, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith('#')) {
      const code = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[key] ?? whole;
  });
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The case-insensitive comparison key for a client or work-type name. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/** One name, cleaned: entities decoded, NBSP as space, whitespace collapsed, trimmed. Never splits. */
export function normalizeName(raw: string): string {
  return collapse(decodeEntities(raw).replace(/\u00a0/g, ' '));
}

/**
 * Turn a pasted list into names (spec §7). Shared by the dashboard preview and the import it
 * submits. Splits on newlines, tabs, table columns and a standalone `·`; drops border runs;
 * de-duplicates case-insensitively keeping the first spelling. Never splits on "/" or ",".
 */
export function parseNameList(text: string): string[] {
  const decoded = decodeEntities(text).replace(/\u00a0/g, ' ');
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of decoded.split(/\r\n|\r|\n/)) {
    for (const cell of line.split(COLUMN_SEPARATOR)) {
      for (const piece of cell.split(MIDDLE_DOT_SEPARATOR)) {
        if (BORDER_ONLY.test(piece)) continue;
        const name = collapse(piece);
        const key = nameKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
  }
  return names;
}
