import type { ReactNode } from 'react';
import { Card } from '../ui/Card';
import { SectionHeader } from '../ui/SectionHeader';
import { DayHeader } from './DayHeader';
import { DayStats } from './DayStats';
import { TimeRibbon } from './TimeRibbon';
import { ActivityBars } from './ActivityBars';
import { TimeEntriesList } from './TimeEntriesList';
import type { PersonDayViewModel } from '../../lib/person-day-view';

/**
 * Top-level composition for the manager's day view. Pure presentational assembly from a
 * `PersonDayViewModel` — all derivation lives in `personDayView`. `screenshots` and `apps` are
 * slots: the page fills them with a panel already wired for that surface (redaction action,
 * self vs. manager scope).
 *
 * `/me` composes the same leaf panels behind its own tab strip rather than reusing this: the
 * self view shows one thing at a time, which is a different shape, not a variant of this one.
 */
export function PersonDayView({
  model,
  avatar,
  back,
  screenshots,
  apps,
}: {
  model: PersonDayViewModel;
  avatar?: ReactNode;
  back?: { href: string; label: string };
  screenshots: ReactNode;
  /** Which applications those hours went to. Sits beside Activity — see below. */
  apps?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* `back` is spread rather than passed: under exactOptionalPropertyTypes an optional
          prop takes the key or nothing, never an explicit undefined. */}
      <DayHeader
        date={model.date}
        subjectName={model.subjectName}
        isSelf={model.isSelf}
        isToday={model.isToday}
        recordingNow={model.recordingNow}
        avatar={avatar}
        {...(back ? { back } : {})}
      />

      <DayStats stats={model.stats} entryCount={model.entries.length} />

      <Card padding="md" className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <SectionHeader label="The day" />
          <TimeRibbon ribbon={model.ribbon} />
        </section>
        {/* Activity answers "how busy", the app list answers "on what". Side by side, because
            either one alone leaves the obvious next question unanswered — a 31% day means
            nothing until you can see it was three hours in a terminal. */}
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <section className="flex flex-col gap-3">
            <SectionHeader label="Activity per hour" />
            <ActivityBars buckets={model.activityBuckets} />
          </section>
          {apps ? (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Apps & sites" />
              {apps}
            </section>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        <Card padding="md" className="flex flex-col gap-3.5">
          <SectionHeader label="Time entries" />
          <TimeEntriesList entries={model.entries} />
        </Card>
        <Card padding="md" className="flex flex-col gap-3.5">
          <SectionHeader label="Screenshots" note="Blurred · fixed interval" />
          {screenshots}
        </Card>
      </div>
    </div>
  );
}
