/**
 * A salon's photographs: the bytes in storage, and the row that says which is
 * which.
 *
 * Two places have to agree, and this module is the only one that knows how:
 *
 *   the bucket   `<salon id>/<kind>/<file>` — the path *is* the permission,
 *                because migration 0013's policies read the salon out of the
 *                first segment and ask is_salon_owner() about it. Build a path
 *                any other way and the rules stop applying while still
 *                appearing to be there.
 *   salon_media  which photograph is the cover, what order they run in, and
 *                the alt text. It has existed since 0001 and never had a row.
 *
 * An upload writes the file first and the row second. If the row fails the file
 * is deleted again, because an orphaned object is invisible — nothing lists the
 * bucket — and would sit there costing storage forever. The reverse order would
 * be worse: a row pointing at a file that does not exist renders as a broken
 * image on the salon's own page.
 */
import { supabase } from '../lib/supabase';
import { fileExtension, prepareImage, type ImageFailure } from '../lib/images';

export const BUCKET = 'salon-photos';

/** What a photograph is of. The second path segment, and nothing more. */
export type PhotoKind = 'cover' | 'gallery';

export interface SalonPhoto {
  id: string;
  path: string;
  /** Ready to put in an <img src>. */
  url: string;
  isCover: boolean;
  alt: string;
  sortOrder: number;
}

export type PhotoFailure = ImageFailure | 'notConfigured' | 'notOwner' | 'network';

interface MediaRow {
  id: string;
  storage_path: string;
  alt_text: string | null;
  is_cover: boolean;
  sort_order: number;
}

/** The public address of an object in a public bucket. */
export function publicUrl(path: string): string {
  if (!supabase) return '';
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function loadPhotos(salonId: string): Promise<SalonPhoto[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('salon_media')
    .select('id, storage_path, alt_text, is_cover, sort_order')
    .eq('salon_id', salonId)
    .order('is_cover', { ascending: false })
    .order('sort_order')
    .returns<MediaRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    path: row.storage_path,
    url: publicUrl(row.storage_path),
    isCover: row.is_cover,
    alt: row.alt_text ?? '',
    sortOrder: row.sort_order,
  }));
}

function writeFailure(error: { code?: string; message?: string } | null): PhotoFailure {
  if (!error) return 'network';
  if (error.code === '42501') return 'notOwner';
  // The storage API reports a refused upload as a message rather than a code.
  if (/row-level security|Unauthorized|violates/i.test(error.message ?? '')) return 'notOwner';
  return 'network';
}

/**
 * Prepares the file, uploads it, and records it.
 *
 * The name is random rather than derived from what the owner called it: their
 * filename could be anything, including somebody's name, and it would end up in
 * a public URL.
 */
export async function uploadPhoto(
  salonId: string,
  file: File,
  kind: PhotoKind = 'gallery',
): Promise<SalonPhoto | { error: PhotoFailure }> {
  if (!supabase) return { error: 'notConfigured' };

  const prepared = await prepareImage(file);
  if ('error' in prepared) return { error: prepared.error };

  const path = `${salonId}/${kind}/${crypto.randomUUID()}.${fileExtension()}`;

  const upload = await supabase.storage.from(BUCKET).upload(path, prepared.blob, {
    contentType: 'image/jpeg',
    // Never overwrite: every path is fresh, so a collision would mean something
    // has gone wrong rather than that a replacement was intended.
    upsert: false,
  });
  if (upload.error) return { error: writeFailure(upload.error) };

  const isCover = kind === 'cover';
  if (isCover) {
    // One cover per salon is a unique index (0001); clear the old one first or
    // the insert below is refused.
    await supabase
      .from('salon_media')
      .update({ is_cover: false })
      .eq('salon_id', salonId)
      .eq('is_cover', true);
  }

  const { data, error } = await supabase
    .from('salon_media')
    .insert({ salon_id: salonId, storage_path: path, is_cover: isCover })
    .select('id, storage_path, alt_text, is_cover, sort_order')
    .single<MediaRow>();

  if (error || !data) {
    // Nothing lists the bucket, so a file with no row is invisible and
    // permanent. Take it back out.
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: writeFailure(error) };
  }

  return {
    id: data.id,
    path: data.storage_path,
    url: publicUrl(data.storage_path),
    isCover: data.is_cover,
    alt: data.alt_text ?? '',
    sortOrder: data.sort_order,
  };
}

/** Removes the row and the file, in that order. */
export async function deletePhoto(photo: SalonPhoto): Promise<PhotoFailure | null> {
  if (!supabase) return 'notConfigured';

  const { error } = await supabase.from('salon_media').delete().eq('id', photo.id);
  if (error) return writeFailure(error);

  // A file left behind after its row is gone is untidy but harmless — nothing
  // can reach it. A row left behind after its file is gone is a broken image on
  // the salon's page, so the row goes first and this is best-effort.
  await supabase.storage.from(BUCKET).remove([photo.path]);
  return null;
}

/** Promotes an existing photograph to the cover. */
export async function makeCover(salonId: string, photoId: string): Promise<PhotoFailure | null> {
  if (!supabase) return 'notConfigured';

  await supabase
    .from('salon_media')
    .update({ is_cover: false })
    .eq('salon_id', salonId)
    .eq('is_cover', true);

  const { error } = await supabase
    .from('salon_media')
    .update({ is_cover: true })
    .eq('id', photoId);

  return error ? writeFailure(error) : null;
}
