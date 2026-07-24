/**
 * Deterministic project → dot color. Projects have no stored color yet (Slice 3 adds the
 * Project.color column + picker); this maps a project id to a stable hue so the same project
 * always renders the same dot. When the column lands it becomes the fallback for a null color.
 * Values are Apple-system hues chosen to read on both the light (#fff) and dark (#2c2c2e) card.
 */
export const PROJECT_PALETTE = [
  '#007aff', // blue
  '#5e5ce6', // indigo
  '#30b0c7', // teal
  '#34c759', // green
  '#ff9500', // orange
  '#ff2d55', // pink
  '#af52de', // purple
  '#ffcc00', // yellow
] as const;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function projectColor(id: string): string {
  const idx = hashString(id) % PROJECT_PALETTE.length;
  // Index is always in range; the `?? [0]` satisfies noUncheckedIndexedAccess.
  return PROJECT_PALETTE[idx] ?? PROJECT_PALETTE[0];
}
