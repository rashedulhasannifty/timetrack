import { describe, it, expect } from 'vitest';
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
