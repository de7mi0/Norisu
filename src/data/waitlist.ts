/**
 * The waitlist, for both sides of it.
 *
 * Everything here goes through the 0009 functions rather than the tables. That
 * is not ceremony: `waitlist_entries.created_at` decides queue position, so an
 * account that could insert its own row could insert itself at the front of the
 * queue, and `status` is what says who is holding a seat. `authenticated` has
 * no INSERT or UPDATE on the table at all.
 *
 * **Nothing here runs on a timer.** There is no push notification and no job
 * runner, so a lapsed hold is only noticed when somebody next reads the
 * waitlist — both read functions sweep before they answer. The queue, the holds
 * and the claim are real; what is missing is the tap on the shoulder.
 */
import { LOAD_TIMEOUT_MS, supabase } from '../lib/supabase';
import type { MyWaitlistRow, SalonWaitlistRow } from '../lib/database.types';
import { toRiyadhDate, toRiyadhTime } from './availability';

export type WaitlistSource = 'loading' | 'live' | 'demo' | 'error';

/** What the customer is waiting for, and whatever is being held for them. */
export interface MyWaitlistEntry {
  id: string;
  salonId: string;
  salonName: string;
  salonNameAr: string;
  /** "2026-09-10", the day they asked about. */
  day: string;
  /** Null when they will take any time that day. */
  from: string | null;
  to: string | null;
  services: string[];
  servicesAr: string[];
  /** Set only while something is being held or is open to them. */
  offerId: string | null;
  /** "15:00" in the salon's own clock. */
  offerTime: string | null;
  offerExpiresAt: string | null;
  /** True when tapping would actually get them the seat. */
  claimable: boolean;
}

/** One person in the salon's queue. */
export interface SalonWaitlistEntry {
  id: string;
  /** Null when they have never given a name — as everywhere else. */
  customerName: string | null;
  day: string;
  from: string | null;
  to: string | null;
  services: string[];
  servicesAr: string[];
  waitingSince: string;
  offerId: string | null;
  offerTime: string | null;
  offerExpiresAt: string | null;
  /** False when somebody is queued behind them, so the button is not offered. */
  canExtend: boolean;
}

export interface MyWaitlist {
  entries: MyWaitlistEntry[];
  source: WaitlistSource;
}

export interface SalonWaitlist {
  entries: SalonWaitlistEntry[];
  source: WaitlistSource;
}

export type WaitlistFailure =
  | 'notConfigured'
  | 'notSignedIn'
  | 'notOffered'
  | 'alreadyWaiting'
  | 'noWaitlist'
  | 'badServices'
  | 'gone'
  | 'queueBehind'
  | 'slotTaken'
  | 'network';

/** 0009's own codes, plus the ones create_booking() raises through a claim. */
function waitlistFailure(error: { code?: string; message?: string } | null): WaitlistFailure {
  if (!error) return 'network';
  switch (error.code) {
    case 'SL001':
      return 'badServices';
    case 'SL003':
    case '23P01':
      return 'slotTaken';
    case 'SL010':
      return 'noWaitlist';
    case 'SL011':
      return 'alreadyWaiting';
    case 'SL012':
      return 'gone';
    case 'SL013':
      return 'queueBehind';
    case '42501':
      return 'notSignedIn';
    default:
      return 'network';
  }
}

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

/** The caller's own entries. Reading is also what advances a lapsed hold. */
export async function loadMyWaitlist(): Promise<MyWaitlist> {
  if (!supabase) return { entries: [], source: 'demo' };
  try {
    const { data, error } = await withTimeout(supabase.rpc('my_waitlist'));
    if (error) return { entries: [], source: 'error' };
    const rows = (data ?? []) as MyWaitlistRow[];
    return {
      entries: rows.map((row) => ({
        id: row.entry_id,
        salonId: row.salon_id,
        salonName: row.salon_name_en,
        salonNameAr: row.salon_name_ar,
        day: row.requested_date,
        from: row.earliest_time,
        to: row.latest_time,
        services: row.service_names_en ?? [],
        servicesAr: row.service_names_ar ?? [],
        offerId: row.offer_id,
        offerTime: row.offer_starts_at ? toRiyadhTime(row.offer_starts_at) : null,
        offerExpiresAt: row.offer_expires_at,
        claimable: Boolean(row.claimable),
      })),
      source: 'live',
    };
  } catch {
    return { entries: [], source: 'error' };
  }
}

/** The salon's queue, oldest first. */
export async function loadSalonWaitlist(salonId: string): Promise<SalonWaitlist> {
  if (!supabase) return { entries: [], source: 'demo' };
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('salon_waitlist', { p_salon_id: salonId }),
    );
    if (error) return { entries: [], source: 'error' };
    const rows = (data ?? []) as SalonWaitlistRow[];
    return {
      entries: rows.map((row) => ({
        id: row.entry_id,
        customerName: row.customer_name,
        day: row.requested_date,
        from: row.earliest_time,
        to: row.latest_time,
        services: row.service_names_en ?? [],
        servicesAr: row.service_names_ar ?? [],
        waitingSince: row.waiting_since,
        offerId: row.offer_id,
        offerTime: row.offer_starts_at ? toRiyadhTime(row.offer_starts_at) : null,
        offerExpiresAt: row.offer_expires_at,
        canExtend: Boolean(row.can_extend),
      })),
      source: 'live',
    };
  } catch {
    return { entries: [], source: 'error' };
  }
}

export interface WaitlistRequest {
  salonId: string;
  serviceIds: string[];
  day: Date;
  /** "16:00"–"20:00", the window they will accept. Null means any time. */
  from?: string | null;
  to?: string | null;
}

export async function joinWaitlist(request: WaitlistRequest): Promise<WaitlistFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.rpc('join_waitlist', {
    p_salon_id: request.salonId,
    p_service_ids: request.serviceIds,
    p_requested_date: toRiyadhDate(request.day),
    p_earliest_time: request.from ?? null,
    p_latest_time: request.to ?? null,
  });
  return error ? waitlistFailure(error) : null;
}

export async function leaveWaitlist(entryId: string): Promise<WaitlistFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.rpc('leave_waitlist', { p_entry_id: entryId });
  return error ? waitlistFailure(error) : null;
}

/** Takes the offered seat. Comes back with the booking's reference on success. */
export async function claimOffer(
  offerId: string,
): Promise<{ reference: string } | { error: WaitlistFailure }> {
  if (!supabase) return { error: 'notConfigured' };
  const { data, error } = await supabase.rpc('claim_waitlist_offer', { p_offer_id: offerId });
  if (error) return { error: waitlistFailure(error) };
  const row = (data ?? [])[0] as { reference?: string } | undefined;
  return row?.reference ? { reference: row.reference } : { error: 'network' };
}

/** The salon giving somebody longer. Refused when others are queued behind. */
export async function extendOffer(offerId: string): Promise<WaitlistFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.rpc('extend_waitlist_offer', {
    p_offer_id: offerId,
    p_minutes: 15,
  });
  return error ? waitlistFailure(error) : null;
}

/** The salon's "Notify": send the freed slot round again, to whoever is next. */
export async function reofferSlot(entryId: string): Promise<WaitlistFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.rpc('reoffer_waitlist_slot', { p_entry_id: entryId });
  return error ? waitlistFailure(error) : null;
}
