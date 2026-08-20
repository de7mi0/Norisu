import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * False when the app is built without connection details, in which case the
 * screens fall back to the bundled demo data and everything still works.
 */
export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * Untyped on purpose. Generated schema types can be dropped in later with
 * `supabase gen types typescript`; until then each query states its own row
 * type via `.returns<T>()`, which keeps the results typed without a
 * hand-maintained schema definition drifting out of sync.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/**
 * How long to wait for any single read before giving up and falling back.
 *
 * supabase-js retries a failed request four times of its own accord and
 * `.abortSignal()` does not always stop it, so an unreachable database can sit
 * silent for far longer than any one request suggests — measured at 19 seconds
 * once. Every module that reads from Supabase races its call against this.
 */
export const LOAD_TIMEOUT_MS = 6000;
