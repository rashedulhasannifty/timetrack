'use server';

import { revalidatePath } from 'next/cache';
import { UpdateSettingsSchema } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';

/** Result of the settings form, surfaced through useActionState. */
export interface SettingsState {
  ok: boolean;
  message?: string;
}

/** Parse a comma/newline-separated app or site list into a trimmed, non-empty string array. */
function parseAppList(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Persist the full monitoring policy. The form renders every field, so we send the whole
 * object (a full replacement, not a partial) — no risk of an absent key resetting another.
 * Numeric bounds and enums are validated through UpdateSettingsSchema before the request; the
 * API re-validates the MERGED object through TeamSettingsSchema and writes an AuditLog row.
 */
export async function updateSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  // Unchecked checkboxes are absent from FormData → false. Numbers arrive as strings.
  const parsed = UpdateSettingsSchema.safeParse({
    screenshotsEnabled: formData.get('screenshotsEnabled') === 'on',
    screenshotIntervalMinutes: Number(formData.get('screenshotIntervalMinutes')),
    screenshotBlur: formData.get('screenshotBlur'),
    screenshotRetentionDays: Number(formData.get('screenshotRetentionDays')),
    activityRetentionDays: Number(formData.get('activityRetentionDays')),
    idleThresholdMinutes: Number(formData.get('idleThresholdMinutes')),
    captureWindowTitles: formData.get('captureWindowTitles') === 'on',
    autoStartOnLogin: formData.get('autoStartOnLogin') === 'on',
    distractionAlertsEnabled: formData.get('distractionAlertsEnabled') === 'on',
    unproductiveApps: parseAppList(formData.get('unproductiveApps')),
    productiveApps: parseAppList(formData.get('productiveApps')),
    unproductiveSites: parseAppList(formData.get('unproductiveSites')),
    productiveSites: parseAppList(formData.get('productiveSites')),
  });
  if (!parsed.success) {
    return { ok: false, message: 'Some values are out of range — check the numeric fields.' };
  }

  try {
    await api.updateTeamSettings(session.accessToken, parsed.data);
    revalidatePath('/admin/settings');
    return { ok: true, message: 'Settings saved.' };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not save settings.' };
  }
}
