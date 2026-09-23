import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectsList } from './ProjectsList';
import { ToastProvider } from '../ui/Toast';
import type { ProjectIndexRow } from '../../lib/projects-index-view';

const row = (over: Partial<ProjectIndexRow> = {}): ProjectIndexRow => ({
  projectId: 'p1',
  name: 'Alpha',
  archived: false,
  trackedSeconds: 3600,
  color: '#007aff',
  tasks: [],
  taskCount: 0,
  sharePct: 50,
  ...over,
});

const render = (rows: ProjectIndexRow[]) =>
  renderToStaticMarkup(
    <ToastProvider>
      <ProjectsList
        rows={rows}
        noProjectSeconds={0}
        residualSeconds={0}
        totalSeconds={7200}
        rangeLabel="Jun 29 – Jul 5, 2026"
      />
    </ToastProvider>,
  );

// Closed-state markup only — Drawer's open state, the row-click guard, and the quick-look
// button's interaction belong in the Playwright suite. This spec covers what the
// server-supplied rows render as before any drawer opens, since vitest here is node-env with
// no DOM to click through.
describe('ProjectsList (closed state)', () => {
  it('renders a row per project, with the name linking to the full project page', () => {
    const html = render([
      row({ projectId: 'p1', name: 'Alpha' }),
      row({ projectId: 'p2', name: 'Beta' }),
    ]);
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('href="/projects/p1"');
    expect(html).toContain('href="/projects/p2"');
  });

  it('renders a quick-look button per project row', () => {
    const html = render([row({ name: 'Alpha' })]);
    expect(html).toContain('aria-label="Quick look at Alpha"');
  });

  it('flags an archived project', () => {
    const html = render([row({ archived: true })]);
    expect(html).toContain('Archived');
  });

  it('does not render the drawer while nothing is open', () => {
    const html = render([row()]);
    // Drawer returns null while closed; its dialog role never appears in closed-state markup.
    expect(html).not.toContain('role="dialog"');
  });

  it('renders "No projects yet." for an empty row list without throwing', () => {
    const html = render([]);
    expect(html).toContain('No projects yet.');
  });
});
