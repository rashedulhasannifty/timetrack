import Link from 'next/link';
import type { TeamListItem } from '@timetrack/contracts';

/**
 * Which team's projects the index is showing. ADMIN only — a project belongs to a team, and
 * before this an org-wide admin had no way to look at another team's projects at all, so a
 * project left behind by a team change was invisible rather than merely unassignable.
 *
 * Plain links, like the settings policy picker: the selection is a URL, so it is shareable and
 * back-button-correct and needs no client JS. Hidden on a single-team deployment, where a
 * picker with one option is noise.
 */
export function ProjectTeamPicker({
  teams,
  selectedId,
  from,
  to,
  includeArchived,
}: {
  teams: TeamListItem[];
  selectedId: string;
  from: string;
  to: string;
  includeArchived: boolean;
}) {
  if (teams.length < 2) return null;

  const href = (teamId: string): string => {
    const q = new URLSearchParams({ from, to, teamId });
    if (includeArchived) q.set('includeArchived', 'true');
    return `/projects?${q.toString()}`;
  };

  return (
    <nav aria-label="Team" className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-text-secondary text-caption mr-1">Projects of</span>
      {teams.map((team) => {
        const active = team.id === selectedId;
        return (
          <Link
            key={team.id}
            href={href(team.id)}
            aria-current={active ? 'page' : undefined}
            className={`text-label rounded-md border px-3 py-1.5 transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-text font-medium'
                : 'border-separator text-text-secondary hover:border-text-secondary hover:text-text'
            }`}
          >
            {team.name}
            <span className="text-text-secondary tt-numeric text-caption ml-2">
              {team.projectCount}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
