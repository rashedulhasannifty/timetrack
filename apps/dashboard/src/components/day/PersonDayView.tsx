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
 * lives in `personDayView`. `screenshots` is a slot: the page fills it with the existing
 * `ScreenshotsPanel`, already wired to the right redaction action for the surface.
 */
export function PersonDayView({
  model,
  avatar,
  screenshots,
}: {
  model: PersonDayViewModel;
  avatar?: ReactNode;
  screenshots: ReactNode;
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
        <section className="flex flex-col gap-3">
          <SectionHeader label="Activity" />
          <ActivityBars buckets={model.activityBuckets} />
        </section>
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
