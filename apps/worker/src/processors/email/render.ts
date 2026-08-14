/**
 * Shared rendering primitives for the worker's outbound email. Pure — every renderer in this
 * directory is unit-testable without SMTP or a queue.
 *
 * `escapeHtml` lives here rather than in each renderer on purpose: HTML escaping is the one
 * function in an email path that must not fork, and three renderers now need it.
 */

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

/** Minimal HTML entity escaping — every interpolated value is operator- or user-supplied. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip a trailing slash so `${appUrl}${path}` never emits `//` (an easy operator slip). */
export function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Whole seconds → a compact `7h 30m`. Rounds to the minute: an email is a summary, and a
 * stray `0h 0m 43s` reads as noise next to a week's worth of hours.
 */
export function formatHours(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/** Wrap pre-escaped body fragments in the same minimal shell the invite email uses. */
export function htmlDocument(bodyParts: string[]): string {
  return [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">',
    ...bodyParts,
    '</body></html>',
  ].join('');
}
