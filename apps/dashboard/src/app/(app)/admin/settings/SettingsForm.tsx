'use client';

import { useActionState, useState } from 'react';
import type { TeamSettings, ObservedApp } from '@timetrack/contracts';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import {
  flaggedTerms,
  availableSuggestions,
  appRuleToken,
  appendTerm,
  type TermKind,
} from '../../../../lib/classification-hints';
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
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium">{label}</span>
      <input
        name={name}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        required
        className="tt-numeric bg-surface border-separator text-text focus:border-accent w-32 rounded-md border px-3 py-2 text-[13px] outline-none transition-colors"
      />
      <span className="text-text-secondary text-caption">{hint}</span>
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
    <label className="flex items-start gap-3">
      <input name={name} type="checkbox" defaultChecked={checked} className="accent-accent mt-1" />
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="text-text-secondary text-caption">{hint}</span>
      </span>
    </label>
  );
}

/**
 * A classification list (app or site) with live, non-blocking hints. The client Categorizer
 * matches silently, so a mistyped term just never matches; this surfaces likely mistakes as the
 * admin types without ever preventing a save. The textarea is controlled so hints stay live, but
 * keeps its `name` so the server action reads it from FormData unchanged.
 */
function ListField({
  name,
  label,
  hint,
  placeholder,
  defaultValue,
  kind,
  suggestions,
}: {
  name: string;
  label: string;
  hint: string;
  placeholder: string;
  defaultValue: string;
  kind: TermKind;
  suggestions?: ObservedApp[];
}) {
  const [value, setValue] = useState(defaultValue);
  const flagged = flaggedTerms(value, kind);
  const picks = suggestions ? availableSuggestions(suggestions, value) : [];
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium">{label}</span>
      <textarea
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 text-[13px] outline-none transition-colors"
      />
      <span className="text-text-secondary text-caption">{hint}</span>
      {picks.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-text-secondary text-caption">Seen recently:</span>
          {picks.map((s) => (
            <button
              key={appRuleToken(s)}
              type="button"
              title={s.bundleId ?? undefined}
              onClick={() => setValue((v) => appendTerm(v, appRuleToken(s)))}
              className="border-separator text-text-secondary hover:border-accent hover:text-text rounded-full border px-2 py-0.5 text-[12px] transition-colors"
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {flagged.length > 0 ? (
        <ul className="text-destructive text-caption mt-1 flex flex-col gap-0.5" role="status">
          {flagged.map((f, i) => (
            <li key={`${f.term}-${i}`}>
              <code>{f.term}</code> — {f.issue}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

/**
 * The monitoring policy editor. Renders every TeamSettings field so a save is a full
 * replacement (see the action). Client component to show the save result inline. Copy is
 * plain and candid about what is captured (design-prompt §0 voice).
 */
export function SettingsForm({
  settings,
  observedApps,
}: {
  settings: TeamSettings;
  observedApps: ObservedApp[];
}) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-col gap-4">
        <div>
          <h2 className="text-text text-[15px] font-semibold">Screenshots</h2>
          <p className="text-text-secondary text-caption">
            Applies org-wide to every macOS client.
          </p>
        </div>
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
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">Blur</span>
            <select
              name="screenshotBlur"
              defaultValue={settings.screenshotBlur}
              className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 text-[13px] outline-none transition-colors"
            >
              <option value="NONE">No blur</option>
              <option value="BLUR">Blur</option>
              <option value="THUMBNAIL_ONLY">Thumbnail only</option>
            </select>
            <span className="text-text-secondary text-caption">How much of a shot is legible.</span>
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
      </Card>

      <Card padding="md" className="flex flex-col gap-4">
        <div>
          <h2 className="text-text text-[15px] font-semibold">Activity &amp; idle</h2>
          <p className="text-text-secondary text-caption">
            How idle time and window titles are tracked.
          </p>
        </div>
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
        <NumberField
          name="distractionRepeatMinutes"
          label="Distraction re-nudge"
          hint="Minutes of continued distraction between reminders (1–60)."
          value={settings.distractionRepeatMinutes}
          min={1}
          max={60}
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-4">
        <div>
          <h2 className="text-text text-[15px] font-semibold">App categories</h2>
          <p className="text-text-secondary text-caption">
            Classify apps as productive or unproductive for reporting.
          </p>
        </div>
        <ListField
          name="productiveApps"
          label="Productive apps"
          hint="One app name per line (or comma-separated)."
          placeholder="One app per line"
          defaultValue={settings.productiveApps.join('\n')}
          kind="app"
          suggestions={observedApps}
        />
        <ListField
          name="unproductiveApps"
          label="Unproductive apps"
          hint="A category label, not a judgement."
          placeholder="One app per line"
          defaultValue={settings.unproductiveApps.join('\n')}
          kind="app"
          suggestions={observedApps}
        />
      </Card>

      <Card padding="md" className="flex flex-col gap-4">
        <div>
          <h2 className="text-text text-[15px] font-semibold">Site categories</h2>
          <p className="text-text-secondary text-caption">
            Matched against the browser&rsquo;s current site host (e.g. <code>youtube.com</code>),
            separately from apps. A host matches its subdomains; a <code>.*</code> suffix (e.g.{' '}
            <code>api.*</code>) matches any host with that leading label.
          </p>
        </div>
        <ListField
          name="productiveSites"
          label="Productive sites"
          hint="One host per line (or comma-separated)."
          placeholder="One site host per line, e.g. docs.google.com"
          defaultValue={settings.productiveSites.join('\n')}
          kind="site"
        />
        <ListField
          name="unproductiveSites"
          label="Unproductive sites"
          hint="A category label, not a judgement."
          placeholder="One site host per line, e.g. youtube.com"
          defaultValue={settings.unproductiveSites.join('\n')}
          kind="site"
        />
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        {state.message ? (
          <p className={`text-body ${state.ok ? 'text-accent' : 'text-destructive'}`} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
