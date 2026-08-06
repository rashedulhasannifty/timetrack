/**
 * Advisory hints for the app/site classification textareas. The client Categorizer matches
 * silently — a mistyped term just never matches, with no feedback. These heuristics flag the
 * common ways a term won't behave as the admin expects. They are NON-BLOCKING: a save is always
 * allowed (the admin may know better); this only surfaces likely mistakes.
 *
 * Matching rules mirrored here (see docs/productivity-classification.md):
 * - Sites match by equality / dotted-suffix (host compared trimmed + lowercased, `www.` already
 *   stripped from the observed host), or a trailing-`.*` leading-label wildcard.
 * - Apps match the macOS frontmost app name by exact (trimmed, case-insensitive) equality.
 */
import type { ObservedApp } from '@timetrack/contracts';

export type TermKind = 'site' | 'app';

/** A human hint if `raw` likely won't match as intended, else null (blank terms are ignored). */
export function termIssue(raw: string, kind: TermKind): string | null {
  const t = raw.trim();
  if (!t) return null;

  if (/^https?:\/\//i.test(t)) return 'Remove the http(s):// — enter just the host.';

  if (kind === 'site') {
    if (t.includes('/')) return 'Enter only the host — paths aren’t matched.';
    if (/\s/.test(t)) return 'A host can’t contain spaces.';
    if (t.toLowerCase().startsWith('www.')) {
      return 'Drop the “www.” — hosts are compared without it, so this won’t match.';
    }
    if (t.includes('*')) {
      if (t === '*' || t === '.*') return 'Give the wildcard a label, e.g. “api.*”.';
      if (!t.endsWith('.*')) {
        return 'Only a trailing “.*” works (e.g. “api.*”); leading or mid-word wildcards don’t match.';
      }
    }
    return null;
  }

  // kind === 'app'
  if (t.includes('/')) return 'Looks like a path/URL — apps match the macOS app name exactly.';
  if (t.includes('*')) return 'Wildcards aren’t used for apps — enter the exact app name.';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) {
    return 'Looks like a site host — did you mean the Sites list? Apps match the macOS app name (e.g. “Code”).';
  }
  return null;
}

/** Parse a textarea value (newline/comma separated) into trimmed, non-empty terms. */
export function parseTerms(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface FlaggedTerm {
  term: string;
  issue: string;
}

/** Every term in `value` that has an issue, for `kind`. */
export function flaggedTerms(value: string, kind: TermKind): FlaggedTerm[] {
  const out: FlaggedTerm[] = [];
  for (const term of parseTerms(value)) {
    const issue = termIssue(term, kind);
    if (issue) out.push({ term, issue });
  }
  return out;
}

/** The rule a picked app inserts: its stable bundleId when known, else the display name. */
export function appRuleToken(app: ObservedApp): string {
  return app.bundleId ?? app.name;
}

/**
 * Observed apps not already classified in `value` — an app counts as present if its name OR its
 * bundleId already appears (case-insensitive), so a name rule and its bundleId equivalent don't
 * both surface. Preserves input order (ranked by usage), capped at `limit`.
 */
export function availableSuggestions(
  suggestions: ObservedApp[],
  value: string,
  limit = 15,
): ObservedApp[] {
  const present = new Set(parseTerms(value).map((t) => t.toLowerCase()));
  const out: ObservedApp[] = [];
  for (const app of suggestions) {
    if (out.length >= limit) break;
    const seen =
      present.has(app.name.trim().toLowerCase()) ||
      (app.bundleId != null && present.has(app.bundleId.trim().toLowerCase()));
    if (!seen) out.push(app);
  }
  return out;
}

/** Append `term` to a textarea value on its own line (no leading blank line for an empty box). */
export function appendTerm(value: string, term: string): string {
  return value.trim().length === 0 ? term : `${value.replace(/\s+$/, '')}\n${term}`;
}
