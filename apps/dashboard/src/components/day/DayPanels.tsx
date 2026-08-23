import type { ReactNode } from 'react';
import { Card, CardTitle } from '../ui/Card';
import { TimeRibbon } from './TimeRibbon';
import { ActivityBars } from './ActivityBars';
import { TimeEntriesList } from './TimeEntriesList';
import { CategoryMixBar } from './CategoryMixBar';
import { IdlePanel } from './IdlePanel';
import type { DayPanel } from './DayTabs';
import type { DayEntryRow, PersonDayViewModel } from '../../lib/person-day-view';
import type { CategoryMix, IdleRow } from '../../lib/idle-view';

/**
 * The body of a day view: whichever of the four panels is selected. Shared by `/me` and
 * `people/[userId]` so the two surfaces stay identical apart from what each is allowed to do —
 * which is expressed as slots, not as a `isSelf` branch scattered through the markup.
 *
 * Only the active panel is rendered. That is the point of the tabs, but it means anything
 * asserting on a panel has to select it first.
 */
export function DayPanels({
  panel,
  model,
  weekStrip,
  apps,
  screenshots,
  mix,
  idle,
  idleAction,
  addEntry,
  entryAction,
}: {
  panel: DayPanel;
  model: PersonDayViewModel;
  /** The week the day sits in. Omitted when the week series couldn't be fetched. */
  weekStrip?: ReactNode;
  apps: ReactNode;
  /** Already wired for the surface: redaction is offered on `/me`, withheld elsewhere. */
  screenshots: ReactNode;
  mix: CategoryMix;
  idle: IdleRow[];
  /** Per-row Keep/Discard control. Omitted for a manager — the API is self-attributed. */
  idleAction?: (row: IdleRow) => ReactNode;
  /** "Add time" for this day. Omitted where the viewer may not write to this person's record. */
  addEntry?: ReactNode;
  /** Per-row edit/delete. Same gate as `addEntry`. */
  entryAction?: (entry: DayEntryRow) => ReactNode;
}) {
  if (panel === 'timeline') {
    return (
      <Card padding="md" className="flex flex-col gap-[22px]">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>The day</CardTitle>
            {weekStrip}
          </div>
          <TimeRibbon ribbon={model.ribbon} />
        </section>
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Time entries</CardTitle>
            {addEntry}
          </div>
          <TimeEntriesList entries={model.entries} rowAction={entryAction} />
        </section>
      </Card>
    );
  }

  if (panel === 'activity') {
    return (
      <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        {/* Activity answers "how busy", the mix answers "what kind of time", the app list
            answers "on what". Each alone leaves the obvious next question unanswered. */}
        <Card padding="md" className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <CardTitle>Active minutes</CardTitle>
            <ActivityBars buckets={model.activityBuckets} />
          </section>
          <section className="border-separator border-t pt-4">
            <CategoryMixBar mix={mix} />
          </section>
        </Card>
        <Card padding="md">
          <CardTitle className="mb-3.5">Apps &amp; sites</CardTitle>
          {apps}
        </Card>
      </div>
    );
  }

  if (panel === 'screenshots') {
    return (
      <Card padding="md">
        <CardTitle className="mb-3.5" note="blurred at capture">
          Screenshots
        </CardTitle>
        {screenshots}
      </Card>
    );
  }

  return (
    <Card padding="md">
      <CardTitle className="mb-2" note="over the team's idle threshold">
        Idle periods
      </CardTitle>
      {/* exactOptionalPropertyTypes: spread the key in only when defined — passing an
          explicit `undefined` is not assignable to an optional prop. */}
      <IdlePanel rows={idle} {...(idleAction ? { action: idleAction } : {})} />
    </Card>
  );
}
