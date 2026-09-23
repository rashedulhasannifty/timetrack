import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Skeleton, TableSkeleton, PageSkeleton } from './Skeleton';

describe('Skeleton', () => {
  it('honours an explicit size', () => {
    const html = renderToStaticMarkup(<Skeleton width={80} height={12} />);
    expect(html).toContain('width:80px');
    expect(html).toContain('height:12px');
  });

  /** Placeholders are chrome, not content: a screen reader announcing a dozen blank boxes
   *  is worse than silence. */
  it('is hidden from assistive tech', () => {
    expect(renderToStaticMarkup(<Skeleton />)).toContain('aria-hidden="true"');
  });
});

describe('TableSkeleton', () => {
  it('renders the requested shape', () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={3} columns={2} />);
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html.match(/<td/g)).toHaveLength(6);
  });

  it('defaults to a usable shape', () => {
    expect(renderToStaticMarkup(<TableSkeleton />)).toContain('<tr');
  });
});

describe('PageSkeleton', () => {
  it('sketches a heading and a card', () => {
    expect(renderToStaticMarkup(<PageSkeleton />)).toContain('aria-hidden="true"');
  });
});
