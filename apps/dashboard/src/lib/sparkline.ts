/**
 * Build the `d` attribute for a sparkline polyline.
 *
 * Points are spaced evenly across `width`; `y` is inverted so the largest value sits at the
 * top of the box. A flat series (every value equal) has no range to normalise against, so it
 * pins to the vertical middle rather than dividing by zero and emitting NaN.
 *
 * Returns '' for fewer than two points — one point is not a trend, and callers render nothing.
 */
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = Math.round(i * stepX * 100) / 100;
      const y = range === 0 ? height / 2 : Math.round(((max - v) / range) * height * 100) / 100;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}
