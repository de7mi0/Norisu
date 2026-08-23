/**
 * The owner's own diary, figures and reviews.
 *
 * These take the same route as availability, and for the same reason: the
 * answer needs to cross a row-level-security boundary that is there on purpose.
 * `bookings_select` already lets an owner read their salon's appointments, but
 * `profiles_select_own` lets nobody read anybody's profile but their own — so
 * the browser can fetch the bookings and still not know whose they are.
 *
 * `salon_day()`, `salon_stats()` and `salon_reviews()` (migration 0005) are
 * `security definer` and answer that narrowly: the customer's display name and
 * nothing else about them. See the migration's own comments for the reasoning
 * and for the ownership guard that stands in for RLS inside them.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';
import type { SalonDayRow, SalonReviewRow, SalonStatsRow } from '../lib/database.types';
import { toRiyadhDate, toRiyadhTime } from './availability';

/**
 * `loading` — the answer is on its way.
 * `live`    — the owner's own salon.
 * `demo`    — sample data: no backend, or this account owns no salon.
 * `error`   — the query failed or timed out; sample data is shown instead.
 */
export type VendorSource = 'loading' | 'live' | 'demo' | 'error';

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface SalonAppointment {
  id: string;
  /** "SL-K3P2A9" — what the customer reads out over the phone. */
  reference: string;
  /** "10:00", the time as the salon reads a clock. */
  time: string;
  endTime: string;
  status: AppointmentStatus;
  /** Null for "any professional": nobody is assigned yet. */
  staffName: string | null;
  staffNameAr: string | null;
  /**
   * Null when the customer has never given a name. The screen shows the
   * booking reference instead — the database deliberately does not hand over an
   * e-mail or phone number to fill the gap.
   */
  customerName: string | null;
  /** Snapshotted at booking time, so this is what they actually agreed to. */
  services: string[];
  servicesAr: string[];
  totalHalalas: number;
}

export interface SalonStats {
  bookingsToday: number;
  bookingsYesterday: number;
  /**
   * What was agreed, **not** what was taken. Nothing is paid yet — bookings
   * record a payment method but `paid_at` stays null — so this must never be
   * labelled revenue on screen.
   */
  bookedHalalas: number;
  /** Null when the salon does not open that day, which is not the same as 0%. */
  occupancyPercent: number | null;
  isOpen: boolean;
  /** Null until somebody reviews the salon, which shows as "New", never 0.0. */
  rating: number | null;
  reviewCount: number;
}

/** One day of the owner's portal: the appointments and the figures together. */
export interface VendorDay {
  appointments: SalonAppointment[];
  stats: SalonStats | null;
  source: VendorSource;
}

export interface SalonReview {
  id: string;
  rating: number;
  body: string;
  reply: string;
  /** ISO instant; the screen formats it through i18n, never at the call site. */
  createdAt: string;
  isPublished: boolean;
  customerName: string | null;
}

export interface VendorReviews {
  reviews: SalonReview[];
  source: VendorSource;
}

/**
 * Why a change to an appointment did not stick.
 *
 * `slotTaken` and `notAllowed` are the two the database answers with, and both
 * need saying in their own words rather than as "could not save": moving an
 * appointment onto somebody who is already busy is the likely outcome of
 * reassigning, and 0006's status trigger is what refuses a change the account
 * is not entitled to make.
 */
export type AppointmentFailure =
  | 'notConfigured'
  | 'slotTaken'
  | 'notAllowed'
  | 'network';

/** Reads Postgres' complaint back as something the owner can act on. */
function appointmentFailure(error: { code?: string; message?: string } | null): AppointmentFailure {
  if (!error) return 'network';
  // The no-double-booking exclusion constraint.
  if (error.code === '23P01' || /exclusion|overlap/i.test(error.message ?? '')) return 'slotTaken';
  if (error.code === '42501') return 'notAllowed';
  return 'network';
}

/**
 * Moves an appointment through the salon's own lifecycle.
 *
 * The rules about *which* changes are legitimate live in the database, in
 * 0006's `bookings_status_transition` trigger — deliberately not duplicated
 * here, because a copy in the browser is a copy that drifts and is not a
 * boundary anyway. This offers what the owner may do and lets Postgres be the
 * authority on it.
 */
export async function setAppointmentStatus(
  bookingId: string,
  status: AppointmentStatus,
): Promise<AppointmentFailure | null> {
  if (!supabase) return 'notConfigured';

  const fields: Record<string, unknown> = { status };
  // Mirrors the customer-side cancel in data/bookings.ts: the row stays, so the
  // salon keeps the history, and the exclusion constraint ignores it so the
  // time frees immediately.
  if (status === 'cancelled') fields.cancelled_at = new Date().toISOString();

  const { error } = await supabase.from('bookings').update(fields).eq('id', bookingId);
  return error ? appointmentFailure(error) : null;
}

/** Hands an appointment to a different specialist, or back to "any professional". */
export async function reassignAppointment(
  bookingId: string,
  staffId: string | null,
): Promise<AppointmentFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.from('bookings').update({ staff_id: staffId }).eq('id', bookingId);
  return error ? appointmentFailure(error) : null;
}

/**
 * Answers a review. Goes through the 0007 function rather than an update,
 * because 0006 revoked UPDATE on `reviews` outright — the customer owns the
 * rating and the body, the salon owns the reply, and a column grant cannot
 * express that split.
 */
export async function replyToReview(
  reviewId: string,
  reply: string,
): Promise<AppointmentFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.rpc('reply_to_review', {
    p_review_id: reviewId,
    p_reply: reply.slice(0, REPLY_MAX_LENGTH),
  });
  return error ? appointmentFailure(error) : null;
}

/** Matches the cap inside reply_to_review(), so nothing is silently truncated. */
export const REPLY_MAX_LENGTH = 1000;

/** Races a call against the shared timeout. Rejects rather than hanging. */
async function withTimeout<T>(call: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function mapAppointment(row: SalonDayRow): SalonAppointment {
  return {
    id: row.booking_id,
    reference: row.reference,
    time: toRiyadhTime(row.starts_at),
    endTime: toRiyadhTime(row.ends_at),
    status: row.status,
    staffName: row.staff_name_en,
    staffNameAr: row.staff_name_ar,
    customerName: row.customer_name,
    services: row.services_en ?? [],
    servicesAr: row.services_ar ?? [],
    totalHalalas: row.total_halalas,
  };
}

/**
 * One salon-day. Never throws: an owner opening the calendar on a quiet
 * Tuesday, an unreachable backend and an account that owns no salon are all
 * ordinary outcomes, so each comes back as something the screen can render.
 *
 * The two calls go together because the dashboard needs both at once, and the
 * calendar's day and the dashboard's figures are always the same question about
 * the same date.
 */
export async function loadVendorDay(salonId: string, day: Date): Promise<VendorDay> {
  if (!supabase) return { appointments: [], stats: null, source: 'demo' };

  const date = toRiyadhDate(day);

  try {
    const [dayResult, statsResult] = await Promise.all([
      withTimeout(supabase.rpc('salon_day', { p_salon_id: salonId, p_day: date })),
      withTimeout(supabase.rpc('salon_stats', { p_salon_id: salonId, p_day: date })),
    ]);

    if (dayResult.error || statsResult.error) {
      return { appointments: [], stats: null, source: 'error' };
    }

    // The client is untyped on purpose (see lib/supabase.ts), so the shapes are
    // asserted here rather than inferred.
    const rows = (dayResult.data ?? []) as SalonDayRow[];
    // salon_stats() returns exactly one row; a missing one means something is
    // wrong rather than that the salon had a quiet day.
    const statsRow = ((statsResult.data ?? []) as SalonStatsRow[])[0];
    if (!statsRow) return { appointments: [], stats: null, source: 'error' };

    return {
      appointments: rows.map(mapAppointment),
      stats: {
        bookingsToday: statsRow.bookings_today,
        bookingsYesterday: statsRow.bookings_yesterday,
        bookedHalalas: Number(statsRow.booked_halalas),
        occupancyPercent: statsRow.occupancy_percent,
        isOpen: statsRow.is_open,
        // numeric arrives as a string over REST.
        rating: statsRow.rating == null ? null : Number(statsRow.rating),
        reviewCount: statsRow.review_count ?? 0,
      },
      source: 'live',
    };
  } catch {
    return { appointments: [], stats: null, source: 'error' };
  }
}

/** The salon's own reviews, unpublished ones included. */
export async function loadSalonReviews(salonId: string): Promise<VendorReviews> {
  if (!supabase) return { reviews: [], source: 'demo' };

  try {
    const { data, error } = await withTimeout(
      supabase.rpc('salon_reviews', { p_salon_id: salonId }),
    );
    if (error) return { reviews: [], source: 'error' };

    const rows = (data ?? []) as SalonReviewRow[];
    return {
      reviews: rows.map((row) => ({
        id: row.review_id,
        // Postgres numeric comes back as a string over REST.
        rating: Number(row.rating),
        body: row.body,
        reply: row.reply,
        createdAt: row.created_at,
        isPublished: row.is_published,
        customerName: row.customer_name,
      })),
      source: 'live',
    };
  } catch {
    return { reviews: [], source: 'error' };
  }
}
