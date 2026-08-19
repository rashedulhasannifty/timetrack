import type { ReactNode } from 'react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { AdminTabs } from '../../../components/ui/AdminTabs';

/**
 * Admin chrome. The heading and the section tabs were repeated verbatim by all four admin
 * pages; hoisting them here means the tab strip is rendered once and a new admin section
 * inherits it by existing.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Admin" subtitle="Policy applies to every macOS client on this team." />
      <AdminTabs />
      {children}
    </>
  );
}
