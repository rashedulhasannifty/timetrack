import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Th, Td } from './Table';

const render = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('Table cells', () => {
  /**
   * Vertical padding comes from --pad-y so the Phase-6 density toggle can retune every
   * table at once. Horizontal padding stays fixed: density changes row height, not gutters.
   */
  it('drives body-cell vertical padding from the density var', () => {
    const html = render(<Td>x</Td>);
    expect(html).toContain('py-[var(--pad-y)]');
    expect(html).toContain('px-[26px]');
  });

  it('drives header-cell vertical padding from the density var', () => {
    expect(render(<Th>x</Th>)).toContain('py-[var(--pad-y)]');
  });

  it('keeps tabular numerals on right-aligned cells', () => {
    expect(render(<Td align="right">1</Td>)).toContain('tt-numeric');
  });

  it('still marks sortable headers with aria-sort', () => {
    expect(
      render(
        <Th sortable sortDirection="asc">
          n
        </Th>,
      ),
    ).toContain('aria-sort="ascending"');
  });
});
