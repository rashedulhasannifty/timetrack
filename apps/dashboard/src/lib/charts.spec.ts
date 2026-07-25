import { describe, it, expect } from 'vitest';
import { donutSegments, linePoints, lineGrid, nearestIndex, gaugeArc } from './charts';

describe('donutSegments', () => {
  it('splits two equal values into equal arcs (minus the gap) with cumulative offsets', () => {
    const segs = donutSegments([{ value: 50 }, { value: 50 }]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.frac).toBe(0.5);
    expect(segs[1]!.frac).toBe(0.5);
    // C = 2*pi*66 ~= 414.7; each segment length ~= 207.3, minus gap(2) => 205.3, rest => 209.3
    expect(segs[0]!.dash).toBe('205.3 209.3');
    expect(segs[1]!.dash).toBe('205.3 209.3');
    // offsets accumulate by the full (un-gapped) segment length
    expect(segs[0]!.offset).toBe('0');
    expect(segs[1]!.offset).toBe('-207.3');
  });

  it('returns all zero-length segments when the total is zero', () => {
    const segs = donutSegments([{ value: 0 }, { value: 0 }]);
    expect(segs).toHaveLength(2);
    for (const seg of segs) {
      expect(seg.frac).toBe(0);
      expect(seg.dash).toBe('0 414.7');
      expect(seg.offset).toBe('0');
    }
  });
});

describe('linePoints', () => {
  it('maps v=max to the top (y=8) and v=0 to the bottom (y=h-4)', () => {
    const { nodes } = linePoints([10, 5, 0], 10);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.y).toBe(8);
    expect(nodes[2]!.y).toBe(166); // h(170) - 4
  });

  it('produces the correct node count and points string', () => {
    const { points, nodes } = linePoints([10, 5, 0], 10);
    expect(nodes).toEqual([
      { x: 0, y: 8, v: 10 },
      { x: 300, y: 87, v: 5 },
      { x: 600, y: 166, v: 0 },
    ]);
    expect(points).toBe('0,8 300,87 600,166');
  });
});

describe('lineGrid', () => {
  it('spans first y=8 to last y=h-4 for a 4-label axis', () => {
    const grid = lineGrid(['Mon', 'Tue', 'Wed', 'Thu']);
    expect(grid).toHaveLength(4);
    expect(grid[0]).toEqual({ y: 8, label: 'Mon' });
    expect(grid[3]).toEqual({ y: 166, label: 'Thu' });
    expect(grid[1]!.y).toBe(60.7);
    expect(grid[2]!.y).toBe(113.3);
  });
});

describe('nearestIndex', () => {
  it('rounds the clamped ratio into a data-point index', () => {
    expect(nearestIndex(0.5, 30)).toBe(15);
    expect(nearestIndex(0, 5)).toBe(0);
    expect(nearestIndex(1, 5)).toBe(4);
  });

  it('clamps ratios outside 0..1', () => {
    expect(nearestIndex(-0.2, 10)).toBe(0);
    expect(nearestIndex(1.5, 10)).toBe(9);
  });
});

describe('gaugeArc', () => {
  it('maps 0% to an empty value arc', () => {
    expect(gaugeArc(0)).toEqual({ dash: '0 175.9', track: '131.9 175.9' });
  });

  it('maps 100% to the full value arc', () => {
    expect(gaugeArc(100)).toEqual({ dash: '131.9 175.9', track: '131.9 175.9' });
  });

  it('clamps values above 100', () => {
    expect(gaugeArc(150)).toEqual({ dash: '131.9 175.9', track: '131.9 175.9' });
  });
});
