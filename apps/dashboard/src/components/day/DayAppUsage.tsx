import type { TeamAppUsage } from '@timetrack/contracts';
import { AppUsageList } from '../overview/AppUsageList';
import { dayAppUsage } from '../../lib/day-app-usage';

/**
 * The application breakdown behind one person's day: which apps and sites those tracked hours
 * actually went to, longest first, colored by nothing — the bar length is time relative to the
 * busiest app, NOT a share of the day, so it is deliberately unlabelled as a percentage.
 *
 * Same endpoint and same authorization as every other read on this page
 * (`/v1/reports/app-usage?userId=…`); the employee sees their own through the route a manager
 * uses, which is the symmetry PRD §4 promises.
 */
export function DayAppUsage({ usage }: { usage: TeamAppUsage | null }) {
  if (usage === null) {
    return <p className="text-text-secondary text-body">App usage is unavailable right now.</p>;
  }
  return <AppUsageList items={dayAppUsage(usage)} />;
}
