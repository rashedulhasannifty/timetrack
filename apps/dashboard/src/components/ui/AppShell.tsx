import type { ReactNode } from 'react';
import { AppNav } from './AppNav';
import { AccountMenu } from './AccountMenu';
import { ThemeToggle } from './ThemeToggle';
import { BrandMark } from './BrandMark';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

/**
 * The authenticated chrome: a two-row header — brand and account controls above, primary
 * navigation below — over a single content column. No page title lives up here; each page
 * owns its own heading, which is what lets the overview open straight onto its stat card.
 *
 * A Server Component: only the nav, the theme toggle and the account menu need the client, and
 * keeping the shell on the server is what lets `tracking` stay a server-rendered Suspense slot
 * passed down from the layout.
 */
export function AppShell({
  role,
  name,
  email,
  tracking,
  children,
}: {
  role: string;
  name: string;
  email: string;
  /** Live-tracking indicator; a Suspense boundary resolved by the layout, or nothing. */
  tracking?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-separator bg-surface-raised flex-none border-b">
        <div className="flex items-center gap-6 px-7 pt-3">
          <span className="text-text flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
            <BrandMark size={20} />
            Nifty Timer
          </span>
          <div className="flex-1" />
          {tracking}
          <ThemeToggle />
          <span className="text-caption text-text-secondary border-separator whitespace-nowrap rounded-sm border px-2.5 py-1">
            {ROLE_LABEL[role] ?? role}
          </span>
          <AccountMenu name={name} email={email} role={role} />
        </div>
        <AppNav />
      </header>
      <main className="flex flex-1 flex-col gap-5 px-7 pb-11 pt-6">{children}</main>
    </div>
  );
}
