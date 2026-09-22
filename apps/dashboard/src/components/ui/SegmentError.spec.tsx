import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SegmentError } from './SegmentError';

const noop = () => {};

describe('SegmentError', () => {
  it('shows fixed copy — not the message — when a digest is present', () => {
    const error = Object.assign(new Error('Cannot deactivate the last active admin'), {
      digest: 'abc123',
    });
    const html = renderToStaticMarkup(<SegmentError error={error} retry={noop} />);
    expect(html).toContain('The page could not be loaded.');
    expect(html).not.toContain('Cannot deactivate the last active admin');
  });

  it('shows the message when there is no digest', () => {
    const error = new Error('Cannot deactivate the last active admin');
    const html = renderToStaticMarkup(<SegmentError error={error} retry={noop} />);
    expect(html).toContain('Cannot deactivate the last active admin');
  });

  it('renders a Try again button', () => {
    const html = renderToStaticMarkup(<SegmentError error={new Error('boom')} retry={noop} />);
    expect(html).toContain('Try again');
    expect(html).toContain('<button');
  });

  /** A heading, not a styled span, so screen-reader users can jump straight to it. */
  it('renders the title as a heading', () => {
    const html = renderToStaticMarkup(<SegmentError error={new Error('boom')} retry={noop} />);
    expect(html).toContain('<h2');
  });
});
