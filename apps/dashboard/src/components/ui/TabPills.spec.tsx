import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabPills, tabPillClasses, TabPillTrack } from './TabPills';

describe('tabPillClasses', () => {
  it('marks every tab as a segment', () => {
    expect(tabPillClasses(true)).toContain('seg-tab');
    expect(tabPillClasses(false)).toContain('seg-tab');
  });

  it('raises only the active tab out of the track', () => {
    expect(tabPillClasses(true)).toContain('bg-surface-raised');
    expect(tabPillClasses(false)).not.toContain('bg-surface-raised');
  });

  it('uses the tightened radius, not a pill', () => {
    expect(tabPillClasses(false)).toContain('rounded-md');
    expect(tabPillClasses(false)).not.toContain('rounded-full');
  });
});

describe('TabPillTrack', () => {
  it('is a recessed track when raised', () => {
    const html = renderToStaticMarkup(<TabPillTrack>x</TabPillTrack>);
    expect(html).toContain('seg-track');
    expect(html).toContain('bg-muted-bg');
  });
});

describe('TabPills', () => {
  const tabs = [
    { href: '/a', label: 'A' },
    { href: '/b', label: 'B' },
  ];

  /**
   * The .seg-tab selected rule keys on aria-current="page" as well as aria-selected,
   * because these tabs are links that map to URLs. If the component stopped emitting
   * aria-current the active tab would render flush with the track — visually broken and
   * unannounced to assistive tech.
   */
  it('marks the active tab with aria-current so the raised rule matches', () => {
    const html = renderToStaticMarkup(
      <TabPills tabs={tabs} activeHref="/b" ariaLabel="Sections" />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});

/**
 * AppUsageTabs (components/overview/AppUsageTabs.tsx) is the only consumer of tabPillClasses
 * that toggles state with aria-pressed instead of a URL-driven aria-current/aria-selected —
 * its buttons are a client-side filter, not links. The `.seg-tab` raised rule in globals.css
 * broke once by matching only aria-current/aria-selected and had to be fixed to also key on
 * aria-pressed; that branch had no regression test. This pins the fix.
 */
describe('.seg-tab aria-pressed styling', () => {
  it("the raised .seg-tab rule in globals.css matches [aria-pressed='true']", () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    const selectorStart = css.indexOf(".seg-tab[aria-current='page']");
    expect(selectorStart, '.seg-tab selected rule not found').toBeGreaterThan(-1);
    const selector = css.slice(selectorStart, css.indexOf('{', selectorStart));
    expect(selector).toContain(".seg-tab[aria-pressed='true']");
  });
});
