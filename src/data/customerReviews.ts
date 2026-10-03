/**
 * Reviews from the customer's side: reading a salon's, and writing your own.
 *
 * Reading goes through `public_reviews()` (0024) rather than the table,
 * because the reviewer's name lives in `profiles`, which nobody may read but
 * its owner. The function returns a first name and an initial and nothing
 * else about the person.
 *
 * Writing is a plain insert. `reviews_insert_after_visit` (0002) is the whole
 * rule — your own booking, at that salon, and marked completed by the salon —
 * and 0015 granted exactly the five columns sent here, so a review cannot
 * arrive pre-answered or hidden.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';

/** Matched to 0015's check constraint on reviews.body. */
export const REVIEW_MAX_LENGTH = 1000;

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  reply: string;
  createdAt: string;
  /** "Nora A.", or null when the customer gave no name. */
  author: string | null;
  servicesEn: string;
  servicesAr: string;
}

interface PublicReviewRow {
  review_id: string;
  rating: number | string;
  body: string;
  reply: string;
  replied_at: string | null;
  created_at: string;
  author: string | null;
  services_en: string | null;
  services_ar: string | null;
}

/**
 * `live` with the rows (possibly none), or `error` when the read failed — which
 * the screen must not present as "no reviews yet", since that is a claim.
 */
export type PublicReviews =
  | { source: 'loading' | 'demo' | 'error'; reviews: PublicReview[] }
  | { source: 'live'; reviews: PublicReview[] };

export async function loadPublicReviews(salonId: string): Promise<PublicReviews> {
  if (!supabase) return { source: 'demo', reviews: [] };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.rpc('public_reviews', { p_salon_id: salonId }),
      expiry,
    ]);
    if (error) return { source: 'error', reviews: [] };
    const rows = (data ?? []) as PublicReviewRow[];
    return {
      source: 'live',
      reviews: rows.map((row) => ({
        id: row.review_id,
        rating: Number(row.rating),
        body: row.body ?? '',
        reply: row.reply ?? '',
        createdAt: row.created_at,
        author: row.author,
        servicesEn: row.services_en ?? '',
        servicesAr: row.services_ar ?? '',
      })),
    };
  } catch {
    return { source: 'error', reviews: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export type ReviewFailure = 'notConfigured' | 'notSignedIn' | 'notCompleted' | 'already' | 'network';

export async function writeReview(input: {
  bookingId: string;
  salonId: string;
  customerId: string;
  rating: number;
  body: string;
}): Promise<ReviewFailure | null> {
  if (!supabase) return 'notConfigured';
  if (!input.customerId) return 'notSignedIn';
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const { error } = await supabase.from('reviews').insert({
    booking_id: input.bookingId,
    salon_id: input.salonId,
    customer_id: input.customerId,
    rating,
    body: input.body.trim().slice(0, REVIEW_MAX_LENGTH),
  });
  if (!error) return null;
  // 23505: reviews.booking_id is unique — this visit already has one.
  if (error.code === '23505') return 'already';
  // 42501: the policy refused — the salon has not marked the visit completed.
  if (error.code === '42501') return 'notCompleted';
  return 'network';
}
