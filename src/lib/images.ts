/**
 * Getting a phone photograph ready to be uploaded.
 *
 * Three things happen here, and only one of them is about file size.
 *
 * **The metadata is removed.** A photograph taken on a phone carries EXIF, and
 * EXIF carries GPS coordinates. Publishing one raw would give away the exact
 * location of the salon and of whoever took the picture — to anyone who
 * downloads it, forever. Re-encoding through a canvas is what strips it: the
 * canvas holds pixels and nothing else, so what comes out the other side has no
 * metadata at all rather than metadata we tried to edit. That is the reason to
 * prefer re-encoding over an EXIF-editing library, which can only remove the
 * tags it knows about.
 *
 * **Orientation is baked in first.** This is the trap. A portrait photograph
 * from a phone is very often stored landscape with an EXIF tag saying "rotate
 * me", so stripping the metadata without acting on it turns every portrait
 * photograph on its side. `imageOrientation: 'from-image'` applies the rotation
 * while decoding, so the pixels themselves come out the right way up and the
 * tag is no longer needed.
 *
 * **It is made small.** A modern phone photograph is several thousand pixels
 * wide and several megabytes. Nothing in this app displays one larger than a
 * phone screen, and a salon on mobile data should not pay for the difference.
 */

/** Longest edge of anything we store. Comfortably above any display size. */
export const MAX_DIMENSION = 1600;

/**
 * What we refuse to even decode. Decoding is where a malicious image does its
 * damage, so the cheap check comes first, on the file as handed to us.
 */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** What the bucket accepts (migration 0013). The output must land under it. */
export const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Whether a file is worth showing on the framing sheet at all. The cheap
 * checks only; the full ones run again in `prepareImage()`, which is where the
 * owner is told why a file was refused.
 */
export function canFrame(file: File): boolean {
  return ACCEPTED.includes(file.type) && file.size <= MAX_SOURCE_BYTES;
}

/** Quality steps tried in order until the result fits. */
const QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4];

export type ImageFailure =
  | 'notAnImage'
  | 'tooLarge'
  | 'unreadable'
  | 'tooBigAfterAll';

/**
 * The part of the photograph to keep, in the decoded image's own pixels —
 * after orientation, so "the top" is the top the owner saw while framing it.
 * Chosen on the crop sheet; absent means the whole photograph.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** What to call the file once it is prepared. Always a JPEG by then. */
export function fileExtension(): string {
  return 'jpg';
}

/**
 * Decodes to pixels with the orientation already applied.
 *
 * `createImageBitmap` is the direct route. Where its options are not supported
 * the fallback is an <img>, which modern browsers also orient from EXIF by
 * default — so both paths agree about which way up the photograph is.
 */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('could not decode'));
      };
      img.src = url;
    });
  }
}

function sizeOf(source: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return source instanceof HTMLImageElement
    ? { w: source.naturalWidth, h: source.naturalHeight }
    : { w: source.width, h: source.height };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Turns whatever the owner picked into something safe to publish.
 *
 * Always answers rather than throwing: choosing the wrong file is an ordinary
 * thing to do, and the codes are translated by the dictionaries so the reason
 * reads in Arabic too — the same shape as `lib/auth.ts` and `lib/push.ts`.
 */
export async function prepareImage(
  file: File,
  crop?: CropRect,
): Promise<PreparedImage | { error: ImageFailure }> {
  if (!ACCEPTED.includes(file.type)) return { error: 'notAnImage' };
  if (file.size > MAX_SOURCE_BYTES) return { error: 'tooLarge' };

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return { error: 'unreadable' };
  }

  const full = sizeOf(source);
  if (!full.w || !full.h) return { error: 'unreadable' };

  // The region to keep, clamped to the picture: a crop is a request from the
  // screen, and a rounding error must not ask the canvas for pixels outside it.
  const region = crop
    ? (() => {
        const x = Math.max(0, Math.min(full.w - 1, Math.round(crop.x)));
        const y = Math.max(0, Math.min(full.h - 1, Math.round(crop.y)));
        return {
          x,
          y,
          w: Math.max(1, Math.min(full.w - x, Math.round(crop.width))),
          h: Math.max(1, Math.min(full.h - y, Math.round(crop.height))),
        };
      })()
    : { x: 0, y: 0, w: full.w, h: full.h };
  const { w, h } = region;

  // Only ever shrink. Blowing a small photograph up to the maximum would cost
  // bytes and add nothing — and that holds for a tight crop too: zooming in
  // keeps the pixels that are there rather than inventing more.
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { error: 'unreadable' };

  // White underneath, because a PNG with transparency becomes black otherwise
  // once it is flattened into a JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  // Still a canvas re-encode, so cropping does not weaken the EXIF stripping:
  // only the chosen pixels are drawn, and nothing else crosses over.
  context.drawImage(source as CanvasImageSource, region.x, region.y, w, h, 0, 0, width, height);
  if ('close' in source) source.close();

  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= MAX_OUTPUT_BYTES) {
      return { blob, width, height };
    }
  }

  // 1600px of photographic noise at the lowest quality still not fitting in
  // three megabytes would be remarkable, but saying so beats uploading
  // something the bucket will refuse.
  return { error: 'tooBigAfterAll' };
}
