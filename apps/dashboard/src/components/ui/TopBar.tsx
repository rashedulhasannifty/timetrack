import { ThemeToggle } from './ThemeToggle';
import { IconPower } from './icons';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

/**
 * The app top bar: today's date (resolved server-side and passed in, to avoid a
 * hydration mismatch), the theme toggle, the signed-in role, and sign-out. Server
 * component; only ThemeToggle inside is a client island.
 */
export function TopBar({ date, role }: { date: string; role: string }) {
  return (
    <header className="border-separator bg-surface-raised flex h-16 shrink-0 items-center justify-between border-b px-8">
      <span className="text-text-secondary text-label tt-numeric">{date}</span>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <div className="flex items-center gap-2.5">
          <span
            className="bg-accent/12 text-accent grid h-8 w-8 place-items-center rounded-full text-caption font-semibold"
            aria-hidden="true"
          >
            {(ROLE_LABEL[role] ?? role).slice(0, 1)}
          </span>
          <span className="text-text text-label font-medium">{ROLE_LABEL[role] ?? role}</span>
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="border-separator text-text-secondary hover:text-destructive grid h-8 w-8 place-items-center rounded-full border transition-colors"
          >
            <IconPower width={16} height={16} />
          </button>
        </form>
      </div>
    </header>
  );
}
