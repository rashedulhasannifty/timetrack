import sharp from 'sharp';

export type BlurMode = 'NONE' | 'BLUR' | 'THUMBNAIL_ONLY';

export interface DerivedScreenshot {
  thumbnail: Buffer;
  rawReplacement: Buffer | null; // set when the raw object must be overwritten (BLUR)
  deleteRaw: boolean; // true when the raw object must be removed (THUMBNAIL_ONLY)
  blurred: boolean;
}

const THUMB_EDGE = 320;
const BLUR_SIGMA = 12;

/**
 * PRD §6.2/§7.4 — derive a grid thumbnail and apply the team blur policy:
 *  - NONE            keep raw as-is, plain downscaled thumbnail
 *  - BLUR            blur both the raw (overwrite) and the thumbnail — no unblurred full-res kept
 *  - THUMBNAIL_ONLY  plain thumbnail, raw deleted — only the small image survives
 */
export async function deriveScreenshot(raw: Buffer, blur: BlurMode): Promise<DerivedScreenshot> {
  const wantBlur = blur === 'BLUR';
  let thumb = sharp(raw).resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside' });
  if (wantBlur) thumb = thumb.blur(BLUR_SIGMA);
  const thumbnail = await thumb.jpeg({ quality: 70 }).toBuffer();

  const rawReplacement = wantBlur ? await sharp(raw).blur(BLUR_SIGMA).toBuffer() : null;

  return {
    thumbnail,
    rawReplacement,
    deleteRaw: blur === 'THUMBNAIL_ONLY',
    blurred: wantBlur,
  };
}
