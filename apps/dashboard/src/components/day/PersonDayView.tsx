import type { ReactNode } from 'react';
import { Card, CardTitle } from '../ui/Card';
import { DayHeader } from './DayHeader';
import { DayStats } from './DayStats';
import { TimeRibbon } from './TimeRibbon';
import { ActivityBars } from './ActivityBars';
import { TimeEntriesList } from './TimeEntriesList';
import type { PersonDayViewModel } from '../../lib/person-day-view';

/**
 * Top-level composition for the day view, shared by `/me` (self) and `people/[userId]`
 * (manager). Pure presentational assembly from a `PersonDayViewModel` — all derivation
 * lives in `personDayView`. `screenshots`, `apps` and `weekStrip` are slots: each page fills
 * them with a panel already wired for that surface (redaction action, self vs. manager scope,
 * the week series that page fetched).
 */
export function PersonDayView({
  model,
  avatar,
  screenshots,
  apps,
  weekStrip,
}: {
  model: PersonDayViewModel;
  avatar?: ReactNode;
  screenshots: ReactNode;
  /** Which applications those hours went to. Sits beside Activity — see below. */
  apps?: ReactNode;
  /** The seven days of this day's week. Omitted when the week series couldn't be fetched. */
  weekStrip?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <DayHeader
        date={model.date}
        subjectName={model.subjectName}
        isSelf={model.isSelf}
        isToday={model.isToday}
        recordingNow={model.recordingNow}
        avatar={avatar}
      />

      <DayStats stats={model.stats} />

      <Card padding="md" className="flex flex-col gap-[22px]">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>The day</CardTitle>
            {weekStrip}
          </div>
          <TimeRibbon ribbon={model.ribbon} />
        </section>
        {/* Activity answers "how busy", the app list answers "on what". Side by side, because
            either one alone leaves the obvious next question unanswered — a 31% day means
            nothing until you can see it was three hours in a terminal. */}
        <div className="grid gap-[30px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <section className="flex flex-col gap-3">
            <span className="text-label text-text-secondary font-bold">Activity per hour</span>
            <ActivityBars buckets={model.activityBuckets} />
          </section>
          {apps ? (
            <section className="flex flex-col gap-3">
              <span className="text-label text-text-secondary font-bold">Apps &amp; sites</span>
              {apps}
            </section>
          ) : null}
        </div>
      </Card>

      <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        <Card padding="md">
          <CardTitle className="mb-2">Time entries</CardTitle>
          <TimeEntriesList entries={model.entries} />
        </Card>
        <Card padding="md">
          <CardTitle className="mb-3.5" note="blurred at capture">
            Screenshots
          </CardTitle>
          {screenshots}
        </Card>
      </div>
    </div>
  );
}
