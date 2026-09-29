import { NAME_MAX_LENGTH, nameKey, normalizeName, type NameSkip } from '@timetrack/contracts';

export interface NameImportPlan {
  accepted: string[];
  skipped: NameSkip[];
}

/**
 * Shared by POST /v1/work-types/bulk and POST /v1/projects/bulk (plan ruling R4). Each raw name is
 * normalized; a bad name is SKIPPED with a reason rather than 422-ing the batch. `taken` maps a
 * `nameKey` to the reason for a name that already exists (the caller words it per domain).
 */
export function planNameImport(
  raw: readonly string[],
  taken: ReadonlyMap<string, string>,
): NameImportPlan {
  const accepted: string[] = [];
  const skipped: NameSkip[] = [];
  const seen = new Set<string>();
  for (const input of raw) {
    const name = normalizeName(input);
    if (name.length === 0) {
      skipped.push({ name: input, reason: 'Empty name' });
      continue;
    }
    if (name.length > NAME_MAX_LENGTH) {
      skipped.push({ name, reason: `Longer than ${NAME_MAX_LENGTH} characters` });
      continue;
    }
    const key = nameKey(name);
    const reason = taken.get(key);
    if (reason !== undefined) {
      skipped.push({ name, reason });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ name, reason: 'Duplicate in list' });
      continue;
    }
    seen.add(key);
    accepted.push(name);
  }
  return { accepted, skipped };
}
