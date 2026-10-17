import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Role } from '@timetrack/contracts';

vi.mock('next/navigation', () => ({ usePathname: () => '/me' }));

import { Sidebar } from './Sidebar';

/**
 * The sidebar only lists what the role can actually open. Before this, an EMPLOYEE saw
 * Overview / Projects / Reports / Approvals / Admin, every one of which rendered a
 * not-permitted state, and a MANAGER saw Admin. The API stays the authority; this is the
 * presentation matching it.
 */
function hrefs(role: Role): string[] {
  const html = renderToStaticMarkup(
    <Sidebar
      narrow={false}
      open
      onNavigate={() => {}}
      name="N"
      email="n@example.com"
      role={role}
    />,
  );
  return [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1] ?? '');
}

describe('Sidebar nav by role', () => {
  it('EMPLOYEE sees only My time and Install the app', () => {
    const links = hrefs('EMPLOYEE');
    expect(links).toEqual(['/me', '/install']);
    for (const hidden of ['/overview', '/projects', '/reports', '/approvals', '/admin/settings']) {
      expect(links).not.toContain(hidden);
    }
  });

  it('MANAGER sees the team surfaces but no Admin', () => {
    const links = hrefs('MANAGER');
    expect(links).toEqual(['/overview', '/projects', '/reports', '/approvals', '/me', '/install']);
    expect(links).not.toContain('/admin/settings');
  });

  it('ADMIN sees every section', () => {
    expect(hrefs('ADMIN')).toEqual([
      '/overview',
      '/projects',
      '/reports',
      '/approvals',
      '/admin/settings',
      '/me',
      '/install',
    ]);
  });
});
