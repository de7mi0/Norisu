/**
 * Time a salon has marked unavailable.
 *
 * The owner's side of availability, and the counterpart to `working_hours`:
 * opening hours say what a normal week looks like, this says what is different
 * about today. A stylist at lunch, a morning off, or — the case it was actually
 * asked for — running late on the customer in the chair, so the next hour has
 * to stop being offered right now.
 *
 * Nothing here enforces anything, and it does not need to. `time_off` has been
 * honoured by `available_slots()` since 0003 and by `create_booking()` since
 * 0008, so a blocked period disappears from the customer's time picker and
 * cannot be booked even by calling the API directly. The row is the whole
 * mechanism; this module only writes it.
 *
 * Written straight to the table rather than through a function, unlike bookings
 * or the waitlist. Those needed a function because a customer must not choose
 * their own price or their own place in a queue. Here every column belongs to
 * the owner, and `time_off_write` (0002) already refuses a salon that is not
 * theirs — the same reasoning as `working_hours`.
 */
import { supabase } from '../lib/supabase';
import { toRiyadhDate } from './availability';

/** A period the salon is not taking bookings for. */
export interface TimeBlock {
  id: string;
  /** Null blocks the whole salon; otherwise just that person. */
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export type TimeOffFailure =
  | 'notConfigured'
  | 'invalidRange'
  | 'notOwner'
  | 'network';

interface TimeOffRow {
  id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

function failure(error: { code?: string } | null): TimeOffFailure {
  if (!error) return 'network';
  // 23514 is the ends_after_start constraint; the form should have caught it.
  if (error.code === '23514') return 'invalidRange';
  if (error.code === '42501') return 'notOwner';
  return 'network';
}

/**
 * Everything blocked on one day, oldest first.
 *
 * The window is a whole Riyadh day either side of midnight rather than a date
 * comparison, because these are instants: a block from 23:00 to 01:00 belongs
 * to the evening it started, and overlaps are what matter, not calendar dates.
 */
export async function loadTimeOff(salonId: string, day: Date): Promise<TimeBlock[]> {
  if (!supabase) return [];

  const date = toRiyadhDate(day);
  const from = `${date}T00:00:00+03:00`;
  const to = `${date}T23:59:59.999+03:00`;

  const { data, error } = await supabase
    .from('time_off')
    .select('id, staff_id, starts_at, ends_at, reason')
    .eq('salon_id', salonId)
    // Any overlap with the day, not only blocks that begin inside it.
    .lt('starts_at', to)
    .gt('ends_at', from)
    .order('starts_at')
    .returns<TimeOffRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason ?? '',
  }));
}

export interface BlockRequest {
  salonId: string;
  /** Null for the whole salon. */
  staffId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

/** How much of a reason we will store. Long enough to be useful on a screen. */
export const REASON_MAX_LENGTH = 60;

export async function blockTime(request: BlockRequest): Promise<TimeOffFailure | null> {
  if (!supabase) return 'notConfigured';
  if (request.endsAt <= request.startsAt) return 'invalidRange';

  const { error } = await supabase.from('time_off').insert({
    salon_id: request.salonId,
    staff_id: request.staffId,
    starts_at: request.startsAt.toISOString(),
    ends_at: request.endsAt.toISOString(),
    reason: request.reason.trim().slice(0, REASON_MAX_LENGTH),
  });

  return error ? failure(error) : null;
}

/** Puts the time back on sale. */
export async function unblockTime(id: string): Promise<TimeOffFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase.from('time_off').delete().eq('id', id);
  return error ? failure(error) : null;
}
