import type { Role } from '@timetrack/contracts';

/**
 * Which dashboard sections a role can open — the single source of truth for the sidebar and
 * for where a fresh session lands. Presentation only: the API (and each page's own guard)
 * remains the authority, so a hand-typed URL still gets the page's not-permitted state.
 *
 * Each rule mirrors what the page and the API it calls already enforce:
 *  - overview   → GET /reports/team-summary            @Roles('MANAGER', 'ADMIN')
 *  - projects   → GET /reports/projects                 @Roles('MANAGER', 'ADMIN')
 *  - reports    → GET /reports/team-summary + /projects @Roles('MANAGER', 'ADMIN')
 *  - approvals  → POST /approvals/:id/decide            @Roles('MANAGER', 'ADMIN').
 *                 GET /approvals also admits EMPLOYEE, but scoped to their own weeks — that
 *                 self-view is the Approvals panel on /me (PRD §6.5); the /approvals page is
 *                 the review queue, which an employee cannot act on.
 *  - admin      → every /admin/* page returns <Forbidden /> unless role === 'ADMIN'
 *  - me, install → every signed-in person
 *
 * Order matters: it is the sidebar order, and the landing page is the first entry that is
 * not `install` (a public page outside the app shell).
 */
export type NavSection =
  'overview' | 'projects' | 'reports' | 'approvals' | 'admin' | 'me' | 'install';

const SECTIONS: Record<Role, readonly NavSection[]> = {
  EMPLOYEE: ['me', 'install'],
  MANAGER: ['overview', 'projects', 'reports', 'approvals', 'me', 'install'],
  ADMIN: ['overview', 'projects', 'reports', 'approvals', 'admin', 'me', 'install'],
};

export const SECTION_HREF: Record<NavSection, string> = {
  overview: '/overview',
  projects: '/projects',
  reports: '/reports',
  approvals: '/approvals',
  admin: '/admin/settings',
  me: '/me',
  install: '/install',
};

export function sectionsFor(role: Role): readonly NavSection[] {
  return SECTIONS[role];
}

export function canSee(role: Role, section: NavSection): boolean {
  return SECTIONS[role].includes(section);
}

/**
 * Where a person lands after signing in (or when no return path was given): the first page
 * their role can open. An unknown role gets /me, which every signed-in person can open.
 */
export function landingPathFor(role: Role | null | undefined): string {
  if (!role) return SECTION_HREF.me;
  const first = SECTIONS[role].find((s) => s !== 'install') ?? 'me';
  return SECTION_HREF[first];
}
