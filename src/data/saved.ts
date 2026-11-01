/**
 * Salons a customer has saved, kept on their account (0027) so the list
 * follows them to another phone.
 *
 * The heart used to live in the reducer and was forgotten on refresh. The
 * policy pins every row to the signed-in account, so nothing here says whose
 * list it is beyond the account id the database checks against.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';

async function withTimeout<T>(call: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** The account's saved salon ids, newest first. Null when it could not be read. */
export async function loadSaved(): Promise<string[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('saved_salons').select('salon_id').order('created_at', { ascending: false }),
    );
    if (error) return null;
    return (data ?? []).map((row: { salon_id: string }) => row.salon_id);
  } catch {
    return null;
  }
}

/** Saves or unsaves. True when the database agreed. */
export async function setSaved(profileId: string, salonId: string, saved: boolean): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = saved
      ? await withTimeout(
          supabase.from('saved_salons').upsert(
            { profile_id: profileId, salon_id: salonId },
            { onConflict: 'profile_id,salon_id', ignoreDuplicates: true },
          ),
        )
      : await withTimeout(
          supabase.from('saved_salons').delete().eq('profile_id', profileId).eq('salon_id', salonId),
        );
    return !error;
  } catch {
    return false;
  }
}
