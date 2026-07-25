/** Pure SVG-geometry helpers for the dashboard chart kit (donut, line, gauge). No React. */

const DONUT_R_DEFAULT = 66;
const DONUT_GAP_DEFAULT = 2;
const LINE_W_DEFAULT = 600;
const LINE_H_DEFAULT = 170;
const GAUGE_TRACK = 175.9;
const GAUGE_VALUE_MAX = 131.9;

/** Round to 1 decimal, matching the mockup's SVG number formatting. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface DonutSegment {
  dash: string;
  offset: string;
  frac: number;
}

/**
 * Per-segment stroke-dasharray/stroke-dashoffset for a donut chart drawn as stacked
 * <circle> strokes (r default 66, small gap between segments, default 2).
 */
export function donutSegments(
  items: { value: number }[],
  opts?: { r?: number; gap?: number },
): DonutSegment[] {
  const r = opts?.r ?? DONUT_R_DEFAULT;
  const gap = opts?.gap ?? DONUT_GAP_DEFAULT;
  const circumference = 2 * Math.PI * r;
  const total = items.reduce((sum, item) => sum + item.value, 0);

  if (total <= 0) {
    return items.map(() => ({
      dash: `${r1(0)} ${r1(circumference)}`,
      offset: `${r1(0)}`,
      frac: 0,
    }));
  }

  let acc = 0;
  return items.map((item) => {
    const frac = item.value / total;
    const len = frac * circumference;
    const dashLen = Math.max(0, len - gap);
    const restLen = circumference - dashLen;
    const offset = -acc;
    acc += len;
    return {
      dash: `${r1(dashLen)} ${r1(restLen)}`,
      offset: `${r1(offset)}`,
      frac,
    };
  });
}

export interface LineNode {
  x: number;
  y: number;
  v: number;
}

export interface LinePoints {
  points: string;
  nodes: LineNode[];
}

/**
 * Plots values into an SVG polyline's `points` string (plus per-node coordinates),
 * mapping v=max to the top (y=8) and v=0 to the bottom (y=h-4).
 */
export function linePoints(
  vals: number[],
  max: number,
  w: number = LINE_W_DEFAULT,
  h: number = LINE_H_DEFAULT,
): LinePoints {
  const n = vals.length;
  const step = n > 1 ? w / (n - 1) : w;
  const m = max > 0 ? max : 1;

  const nodes: LineNode[] = vals.map((v, i) => ({
    x: r1(i * step),
    y: r1(h - (v / m) * (h - 12) - 4),
    v,
  }));

  const points = nodes.map((node) => `${node.x},${node.y}`).join(' ');

  return { points, nodes };
}

export interface LineGridLine {
  y: number;
  label: string;
}

/** Horizontal grid lines evenly spaced between y=8 (top) and y=h-4 (bottom). */
export function lineGrid(axis: string[], h: number = LINE_H_DEFAULT): LineGridLine[] {
  const n = axis.length;
  const denom = n > 1 ? n - 1 : 1;
  return axis.map((label, i) => ({
    y: r1(8 + i * ((h - 12) / denom)),
    label,
  }));
}

/** Nearest data-point index for a pointer position expressed as a 0..1 ratio across the plot. */
export function nearestIndex(ratio: number, n: number): number {
  return Math.round(clamp(ratio, 0, 1) * (n - 1));
}

export interface GaugeArc {
  dash: string;
  track: string;
}

/** stroke-dasharray for a gauge's value arc + its (constant) track arc. */
export function gaugeArc(pct: number): GaugeArc {
  const value = (clamp(pct, 0, 100) / 100) * GAUGE_VALUE_MAX;
  return {
    dash: `${r1(value)} ${r1(GAUGE_TRACK)}`,
    track: `${r1(GAUGE_VALUE_MAX)} ${r1(GAUGE_TRACK)}`,
  };
}
