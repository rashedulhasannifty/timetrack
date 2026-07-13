'use client';

import { useActionState } from 'react';
import type { TeamSettings } from '@timetrack/contracts';
import { updateSettingsAction, type SettingsState } from './actions';

const INITIAL: SettingsState = { ok: false };

function NumberField({
  name,
  label,
  hint,
  value,
  min,
  max,
}: {
  name: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        required
        className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-sm tabular-nums"
      />
      <span className="text-xs text-neutral-500">{hint}</span>
    </label>
  );
}

function Toggle({
  name,
  label,
  hint,
  checked,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input name={name} type="checkbox" defaultChecked={checked} className="mt-1" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="text-xs text-neutral-500">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The monitoring policy editor. Renders every TeamSettings field so a save is a full
 * replacement (see the action). Client component to show the save result inline. Copy is
 * plain and candid about what is captured (design-prompt §0 voice).
 */
export function SettingsForm({ settings }: { settings: TeamSettings }) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, INITIAL);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Screenshots</h2>
        <Toggle
          name="screenshotsEnabled"
          label="Capture screenshots"
          hint="When off, no screenshots are taken for anyone on the team."
          checked={settings.screenshotsEnabled}
        />
        <div className="flex flex-wrap gap-6">
          <NumberField
            name="screenshotIntervalMinutes"
            label="Interval"
            hint="Minutes between shots (5–60)."
            value={settings.screenshotIntervalMinutes}
            min={5}
            max={60}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Blur</span>
            <select
              name="screenshotBlur"
              defaultValue={settings.screenshotBlur}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="NONE">No blur</option>
              <option value="BLUR">Blur</option>
              <option value="THUMBNAIL_ONLY">Thumbnail only</option>
            </select>
            <span className="text-xs text-neutral-500">How much of a shot is legible.</span>
          </label>
          <NumberField
            name="screenshotRetentionDays"
            label="Retention"
            hint="Days screenshots are kept (1–180)."
            value={settings.screenshotRetentionDays}
            min={1}
            max={180}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Activity & idle</h2>
        <div className="flex flex-wrap gap-6">
          <NumberField
            name="activityRetentionDays"
            label="Activity retention"
            hint="Days activity samples are kept (7–365)."
            value={settings.activityRetentionDays}
            min={7}
            max={365}
          />
          <NumberField
            name="idleThresholdMinutes"
            label="Idle threshold"
            hint="Minutes of no input before idle (1–60)."
            value={settings.idleThresholdMinutes}
            min={1}
            max={60}
          />
        </div>
        <Toggle
          name="captureWindowTitles"
          label="Capture window titles"
          hint="Record the title of the active window alongside the app name."
          checked={settings.captureWindowTitles}
        />
        <Toggle
          name="autoStartOnLogin"
          label="Auto-start tracking on login"
          hint="Off by default; employees can still start manually."
          checked={settings.autoStartOnLogin}
        />
        <Toggle
          name="distractionAlertsEnabled"
          label="Distraction alerts"
          hint="Local-only nudges on unproductive apps; nothing is sent to managers."
          checked={settings.distractionAlertsEnabled}
        />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-700">App categories</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Productive apps</span>
          <textarea
            name="productiveApps"
            defaultValue={settings.productiveApps.join('\n')}
            rows={3}
            placeholder="One app per line"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <span className="text-xs text-neutral-500">
            One app name per line (or comma-separated).
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Unproductive apps</span>
          <textarea
            name="unproductiveApps"
            defaultValue={settings.unproductiveApps.join('\n')}
            rows={3}
            placeholder="One app per line"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <span className="text-xs text-neutral-500">A category label, not a judgement.</span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {state.message ? (
          <p className={`text-sm ${state.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
