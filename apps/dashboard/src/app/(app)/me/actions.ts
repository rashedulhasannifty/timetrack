'use server';

import { revalidatePath } from 'next/cache';
import { RedactScreenshotSchema } from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';

export type RedactResult = { ok: true } | { ok: false; error: string };

/**
 * Employee redacts their own screenshot. Runs server-side so the access token never
 * reaches the browser (CLAUDE.md §4). Owner-only + idempotency are enforced by the API;
 * here we trim + require a non-empty reason (the server re-validates via the same schema).
 * On success we revalidate /me so the tile re-renders as a REDACTED tombstone.
 */
export async function redactScreenshotAction(id: string, reason: string): Promise<RedactResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not signed in.' };

  const parsed = RedactScreenshotSchema.safeParse({ reason: reason.trim() });
  if (!parsed.success) return { ok: false, error: 'A reason is required.' };

  try {
    await api.redactScreenshot(session.accessToken, id, parsed.data);
    revalidatePath('/me');
    return { ok: true };
  } catch {
    // Never surface raw API/error text to the browser.
    return { ok: false, error: 'Could not redact — try again.' };
  }
}
