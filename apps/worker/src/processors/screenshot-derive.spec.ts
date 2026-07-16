import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { deriveScreenshot } from './screenshot-derive.js';

async function pngFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe('deriveScreenshot', () => {
  it('NONE → thumbnail produced, raw kept, not blurred', async () => {
    const out = await deriveScreenshot(await pngFixture(), 'NONE');
    const meta = await sharp(out.thumbnail).metadata();
    expect(meta.width ?? 0).toBeLessThanOrEqual(320);
    expect(out.rawReplacement).toBeNull();
    expect(out.deleteRaw).toBe(false);
    expect(out.blurred).toBe(false);
  });

  it('BLUR → thumbnail + blurred raw replacement, blurred flag true', async () => {
    const out = await deriveScreenshot(await pngFixture(), 'BLUR');
    expect(out.rawReplacement).toBeInstanceOf(Buffer);
    expect(out.deleteRaw).toBe(false);
    expect(out.blurred).toBe(true);
  });

  it('THUMBNAIL_ONLY → thumbnail produced, raw scheduled for deletion', async () => {
    const out = await deriveScreenshot(await pngFixture(), 'THUMBNAIL_ONLY');
    expect(out.deleteRaw).toBe(true);
    expect(out.rawReplacement).toBeNull();
    expect(out.blurred).toBe(false);
  });
});
