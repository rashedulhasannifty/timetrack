import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import type { ScreenshotView } from './screenshot-view';

/**
 * The grouping transform is unit-tested on its own; this checks the part a pure function cannot —
 * that the panel actually renders one group box per capture tick, with the displays of a tick
 * inside it.
 *
 * `renderToStaticMarkup` needs no DOM, so it runs in this node-env vitest (there is no jsdom
 * here). It is the first paint only: no clicks, no lightbox, no redaction flow. Those still
 * belong to the Playwright spec.
 */
const shot = (
  id: string,
  timestamp: string,
  group: { id: string; index: number; count: number } | null,
): ScreenshotView => ({
  id,
  status: 'READY',
  url: `https://minio.test/thumb/${id}`,
  fullUrl: `https://minio.test/raw/${id}`,
  redactedReason: null,
  timestamp,
  captureGroupId: group?.id ?? null,
  displayIndex: group?.index ?? null,
  displayCount: group?.count ?? null,
});

const TICK = '2026-08-14T12:43:47.000Z';

describe('ScreenshotsPanel render', () => {
  it('renders one group per capture tick, with every display of that tick inside it', () => {
    const html = renderToStaticMarkup(
      <ScreenshotsPanel
        shots={[
          shot('a', TICK, { id: 'g1', index: 0, count: 2 }),
          shot('b', TICK, { id: 'g1', index: 1, count: 2 }),
          shot('c', '2026-08-14T12:33:47.000Z', { id: 'g2', index: 0, count: 2 }),
          shot('d', '2026-08-14T12:33:47.000Z', { id: 'g2', index: 1, count: 2 }),
        ]}
      />,
    );

    // Two ticks → two group boxes, four tiles in total. Matched on the closing tag so the
    // count is of visible captions, not of the accessible labels that also name the display.
    expect(html.match(/2 displays/g)).toHaveLength(2);
    expect(html.match(/>Display 1<\/figcaption>/g)).toHaveLength(2);
    expect(html.match(/>Display 2<\/figcaption>/g)).toHaveLength(2);
    expect(html.match(/<img/g)).toHaveLength(4);
    // Each display is separately reachable by name, so the grid is navigable without sight.
    expect(html).toContain('View screenshot at 18:43 · Display 2 full size');
    // The group header carries the shared capture time; the tiles name their display instead of
    // repeating it.
    expect(html).toContain('18:43');
  });

  /** A one-screen desk must look exactly as it always did — no stray "1 display" chip. */
  it('renders a single-display capture without a group badge', () => {
    const html = renderToStaticMarkup(<ScreenshotsPanel shots={[shot('a', TICK, null)]} />);
    expect(html).not.toContain('display');
    expect(html).not.toContain('Display');
    expect(html).toContain('18:43');
  });

  /**
   * A display that failed to capture: the group says so rather than passing one screen off as
   * the whole desk.
   */
  it('marks a group as incomplete when a display failed to capture', () => {
    const html = renderToStaticMarkup(
      <ScreenshotsPanel shots={[shot('a', TICK, { id: 'g1', index: 0, count: 2 })]} />,
    );
    expect(html).toContain('1 of 2 displays');
    expect(html).toContain('A display failed to capture in this interval.');
  });

  /**
   * Regression: every group used to be its own full-width row, so a one-display day rendered a
   * single 160px tile per row — a long column of mostly empty space. Groups now share one grid,
   * and a multi-display group spans as many cells as it has displays (capped at 3).
   */
  it('lays groups out in one shared grid instead of a row each', () => {
    const html = renderToStaticMarkup(
      <ScreenshotsPanel
        shots={[
          shot('a', TICK, null),
          shot('b', '2026-08-14T12:33:47.000Z', null),
          shot('c', '2026-08-14T12:23:47.000Z', { id: 'g3', index: 0, count: 2 }),
          shot('d', '2026-08-14T12:23:47.000Z', { id: 'g3', index: 1, count: 2 }),
        ]}
      />,
    );
    // First <ul> is the outer list (React hoists image preload <link>s ahead of it).
    const outer = html.match(/<ul class="([^"]*)"/)?.[1] ?? '';
    expect(outer).toContain('grid');
    expect(outer).not.toContain('flex-col');
    // Single-display groups take one cell; the two-display group spans two.
    expect(html.match(/col-span-2/g)).toHaveLength(1);
  });

  it('caps the span of a wide multi-display group so it cannot force the grid wider', () => {
    const four = [0, 1, 2, 3].map((i) => shot(`s${i}`, TICK, { id: 'g4', index: i, count: 4 }));
    const html = renderToStaticMarkup(<ScreenshotsPanel shots={four} />);
    expect(html).toContain('col-span-3');
    expect(html).not.toContain('col-span-4');
  });

  it('says so when the day has no captures at all', () => {
    const html = renderToStaticMarkup(<ScreenshotsPanel shots={[]} />);
    expect(html).toContain('No screenshots recorded today.');
  });
});
