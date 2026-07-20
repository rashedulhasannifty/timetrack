import { SYSTEM_ACTOR_ID } from '@timetrack/contracts';

/** Human label for an audit actor: "System" for the nil-UUID job actor, "Name (email)" when
 *  resolved, else the raw UUID (a deactivated/erased actor no longer resolves to a User). */
export function actorLabel(item: {
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
}): string {
  if (item.actorId === SYSTEM_ACTOR_ID) return 'System';
  if (item.actorName) {
    return item.actorEmail ? `${item.actorName} (${item.actorEmail})` : item.actorName;
  }
  return item.actorId;
}

/** Pretty-printed diff text (rendering/styling is the component's job). */
export function formatDiff(diff: unknown): string {
  if (diff === null || diff === undefined) return '—';
  return JSON.stringify(diff, null, 2);
}

/** Normalize a filter date (from a <input type="date">, "YYYY-MM-DD") to the ISO instant the API
 *  requires (z.iso.datetime()). Empty/unparseable → undefined (filter omitted). Date-only strings
 *  parse as UTC midnight per spec, so this is timezone-stable. */
export function toIso(date?: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Build the audit query string. Reads only the four filters from `filters`; the cursor comes
 *  from the explicit arg so a "Next" link can override the current page's cursor. */
export function buildAuditParams(
  filters: { targetType?: string; targetId?: string; from?: string; to?: string },
  cursor?: string | null,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (cursor) params.set('cursor', cursor);
  return params;
}
