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
 * Top-level composition for the day view, shared by `/me` (self) and `people/[userId]`
 * (manager). Pure presentational assembly from a `PersonDayViewModel` — all derivation
 * lives in `personDayView`. `screenshots` and `apps` are slots: each page fills them with a
 * panel already wired for that surface (redaction action, self vs. manager scope).
 */
export function PersonDayView({
  model,
  avatar,
  screenshots,
  apps,
}: {
  model: PersonDayViewModel;
  avatar?: ReactNode;
  screenshots: ReactNode;
  /** Which applications those hours went to. Sits beside Activity — see below. */
  apps?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DayHeader
        date={model.date}
        subjectName={model.subjectName}
        isSelf={model.isSelf}
        isToday={model.isToday}
        recordingNow={model.recordingNow}
        avatar={avatar}
      />

      <DayStats stats={model.stats} />

      <Card padding="md" className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <SectionHeader label="Your day" />
          <TimeRibbon ribbon={model.ribbon} />
        </section>
        {/* Activity answers "how busy", the app list answers "on what". Side by side, because
            either one alone leaves the obvious next question unanswered — a 31% day means
            nothing until you can see it was three hours in a terminal. */}
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <section className="flex flex-col gap-3">
            <SectionHeader label="Activity" />
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
        <section className="flex flex-col gap-3">
          <SectionHeader label="Time entries" />
          <Card padding="md">
            <TimeEntriesList entries={model.entries} />
          </Card>
        </section>
        <section className="flex flex-col gap-3">
          <SectionHeader label="Screenshots" />
          <Card padding="md">{screenshots}</Card>
        </section>
      </div>
    </div>
  );
}
