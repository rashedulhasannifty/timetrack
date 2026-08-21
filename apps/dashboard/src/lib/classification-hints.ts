/**
 * Advisory hints for the app/site classification textareas. The client Categorizer matches
 * silently — a mistyped term just never matches, with no feedback. These heuristics flag the
 * common ways a term won't behave as the admin expects. They are NON-BLOCKING: a save is always
 * allowed (the admin may know better); this only surfaces likely mistakes.
 *
 * Matching rules mirrored here (see docs/productivity-classification.md):
 * - Sites match by equality / dotted-suffix (host compared trimmed + lowercased, `www.` already
 *   stripped from the observed host), or a trailing-`.*` leading-label wildcard.
 * - Apps match by exact (trimmed, case-insensitive) equality against EITHER the macOS app's
 *   display name OR its bundle id — see Categorizer.swift. A bundle id rule is the more durable
 *   of the two, since it survives the app being renamed, which is why picking an app from the
 *   suggestions inserts one.
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
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) && !looksLikeBundleId(t)) {
    return 'Looks like a site host — did you mean the Sites list? Apps match the macOS app name or bundle id (e.g. “Code”, “com.apple.TextEdit”).';
  }
  return null;
}

/**
 * The labels a reverse-DNS bundle id starts with. Not a TLD list — the point is only to tell
 * `com.apple.TextEdit` from `calendar.google.com`, and the difference is WHICH END the
 * registry-ish label sits at: a bundle id leads with it, a host trails it.
 */
const REVERSE_DNS_PREFIXES = new Set([
  'com',
  'org',
  'net',
  'io',
  'co',
  'us',
  'uk',
  'de',
  'fr',
  'jp',
  'ca',
  'au',
  'nl',
  'se',
  'no',
  'fi',
  'dk',
  'ch',
  'at',
  'it',
  'es',
  'ru',
  'br',
  'in',
  'cn',
  'app',
  'dev',
  'me',
  'tv',
  'cloud',
]);

/**
 * Whether `t` reads as a macOS bundle id rather than a site host. Both are dotted, so the naive
 * "contains a dot → it's a host" test flagged every bundle id as a mistake — including the ones
 * the app itself inserts when an admin picks from the suggested-apps list. Picking ClickUp
 * inserted `com.clickup.desktop-app` and was told it looked like a website.
 *
 * Three labels minimum, so a genuine two-label host whose TLD happens to be a country code —
 * `zoom.us`, `bit.ly` — is still correctly flagged as a site.
 */
function looksLikeBundleId(t: string): boolean {
  const labels = t.split('.');
  if (labels.length < 3) return false;
  return REVERSE_DNS_PREFIXES.has(labels[0]!.toLowerCase());
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
 * Observed apps not already classified — an app counts as present if its name OR its bundleId
 * already appears (case-insensitive), so a name rule and its bundleId equivalent don't both
 * surface. `value` may be several textarea contents (e.g. the productive AND unproductive lists):
 * an app classified in EITHER is excluded, so a suggestion can't offer a one-click move that
 * silently reclassifies an already-categorised app (apps overlap → UNPRODUCTIVE wins). Preserves
 * input order (ranked by usage), capped at `limit`.
 */
export function availableSuggestions(
  suggestions: ObservedApp[],
  value: string | string[],
  limit = 15,
): ObservedApp[] {
  const values = Array.isArray(value) ? value : [value];
  const present = new Set(values.flatMap((v) => parseTerms(v)).map((t) => t.toLowerCase()));
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
