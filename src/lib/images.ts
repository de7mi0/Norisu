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

/** Quality steps tried in order until the result fits. */
const QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4];

export type ImageFailure =
  | 'notAnImage'
  | 'tooLarge'
  | 'unreadable'
  | 'tooBigAfterAll';

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
export async function prepareImage(file: File): Promise<PreparedImage | { error: ImageFailure }> {
  if (!ACCEPTED.includes(file.type)) return { error: 'notAnImage' };
  if (file.size > MAX_SOURCE_BYTES) return { error: 'tooLarge' };

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return { error: 'unreadable' };
  }

  const { w, h } = sizeOf(source);
  if (!w || !h) return { error: 'unreadable' };

  // Only ever shrink. Blowing a small photograph up to the maximum would cost
  // bytes and add nothing.
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
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
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
