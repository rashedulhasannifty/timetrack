import { describe, expect, it } from 'vitest';
import { screenshotRetentionLabel } from './screenshot-retention';

describe('screenshotRetentionLabel', () => {
  it('shows the retention days while screenshots expire', () => {
    expect(
      screenshotRetentionLabel({ screenshotRetentionDays: 30, keepScreenshotsForever: false }),
    ).toBe('30 days');
  });

  it('does not show the stored days as if they applied when the team keeps forever', () => {
    expect(
      screenshotRetentionLabel({ screenshotRetentionDays: 30, keepScreenshotsForever: true }),
    ).toBe('Kept until turned off');
  });
});
