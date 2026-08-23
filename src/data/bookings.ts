/**
 * Bookings that survive a refresh.
 *
 * Everything the customer agreed to is **snapshotted** onto the booking and its
 * items at the moment it is made. A salon raising its prices tomorrow must
 * never change what somebody was charged today, so nothing here is looked up
 * again on read — the rows carry their own copy of the name, price and
 * duration.
 *
 * Money is integer halalas throughout (`15000` = 150.00 SAR). Never floats.
 */
import { supabase } from '../lib/supabase';
import type { BookingItemRow, BookingRow } from '../lib/database.types';
import type { Booking, Service } from '../types';
import { instantLabel } from '../i18n';
import { VAT_RATE } from './services';
import { tile } from '../theme';

/** Saudi Arabia does not observe daylight saving, so the offset is fixed. */
const RIYADH_OFFSET = '+03:00';

export interface BookingDraft {
  salonId: string;
  salonName: string;
  salonNameAr: string;
  salonTile: string;
  /** Null for "any professional" — the salon assigns someone later. */
  staffId: string | null;
  staffName: string;
  staffNameAr: string;
  services: Service[];
  /** Midnight on the chosen day, local time. */
  date: Date;
  /** "14:30", from the slot the customer tapped. */
  time: string;
  paymentMethod: string;
}

export type BookingFailure =
  | 'notConfigured'
  | 'notSignedIn'
  | 'noServices'
  | 'noSlot'
  | 'slotTaken'
  | 'closed'
  | 'sampleData'
  | 'network';

/**
 * Turns Postgres' complaint into something the customer can act on. The codes
 * are create_booking()'s own (migration 0008); 23P01 is the no-double-booking
 * constraint having the last word after a chair was assigned.
 */
function bookingFailure(error: { code?: string; message?: string } | null): BookingFailure {
  if (!error) return 'network';
  switch (error.code) {
    case 'SL001':
      return 'noServices';
    case 'SL002':
      return 'closed';
    case 'SL003':
    case '23P01':
      return 'slotTaken';
    case '42501':
      return 'notSignedIn';
    default:
      return /exclusion|overlap/i.test(error.message ?? '') ? 'slotTaken' : 'network';
  }
}

/** The exact stored price, falling back to the display price for demo rows. */
function halalasOf(service: Service): number {
  return service.priceHalalas ?? service.price * 100;
}

/** What a line costs after its own discount, rounded to the halala. */
function lineTotalHalalas(service: Service): number {
  const gross = halalasOf(service);
  return service.discount ? Math.round(gross * (1 - service.discount / 100)) : gross;
}

/**
 * Totals in halalas, computed from the exact stored prices rather than from the
 * rounded riyals on screen — otherwise the invoice and the database disagree by
 * a few halalas on every discounted line.
 *
 * **Display only.** Since 0008 the figure that is actually stored is computed by
 * `create_booking()` from the salon's own `services` rows, because a price the
 * browser states is a price the browser can lie about. This draws the cart
 * total; the arithmetic is mirrored in the function, and assertion 17 checks the
 * two agree.
 */
export function totalsFor(services: Service[]) {
  const subtotal = services.reduce((sum, service) => sum + halalasOf(service), 0);
  const afterDiscount = services.reduce((sum, service) => sum + lineTotalHalalas(service), 0);
  const vat = Math.round(afterDiscount * VAT_RATE);
  return {
    subtotalHalalas: subtotal,
    discountHalalas: subtotal - afterDiscount,
    vatHalalas: vat,
    totalHalalas: afterDiscount + vat,
  };
}

/** Combines the chosen day and slot into an instant, read as Riyadh local time. */
export function startsAt(date: Date, time: string): Date {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return new Date(`${year}-${month}-${day}T${time}:00${RIYADH_OFFSET}`);
}

/**
 * Makes the booking.
 *
 * One call, one transaction, and almost nothing is taken on trust: the price,
 * the end time, the staff member and the reference are all decided by
 * `create_booking()` (migration 0008) from the salon's own rows. The browser
 * says which salon, which services and when, and that is all it is allowed to
 * say — `authenticated` has no INSERT privilege on `bookings` at all any more.
 *
 * That closes three things at once. The client could state its own total; "any
 * professional" left `staff_id` null so the no-double-booking constraint had
 * nobody to compare against and the salon could be oversold; and the booking
 * and its items were two round trips with a compensating delete between them.
 */
export async function createBooking(
  draft: BookingDraft,
  customerId: string,
): Promise<{ reference: string } | { error: BookingFailure }> {
  if (!supabase) return { error: 'notConfigured' };
  if (!customerId) return { error: 'notSignedIn' };
  if (draft.services.length === 0) return { error: 'noServices' };

  // A service with no stored price came from the bundled sample catalogue, not
  // the database, so its id is not one the function can look up. Said plainly
  // rather than sent and refused.
  if (draft.services.some((service) => service.priceHalalas == null)) {
    return { error: 'sampleData' };
  }

  const start = startsAt(draft.date, draft.time);
  if (Number.isNaN(start.getTime())) return { error: 'noSlot' };

  try {
    const { data, error } = await supabase.rpc('create_booking', {
      p_salon_id: draft.salonId,
      p_staff_id: draft.staffId,
      p_service_ids: draft.services.map((service) => service.id),
      p_starts_at: start.toISOString(),
      p_payment_method: draft.paymentMethod,
    });

    if (error) return { error: bookingFailure(error) };

    const row = (data ?? [])[0] as { reference?: string } | undefined;
    if (!row?.reference) return { error: 'network' };
    return { reference: row.reference };
  } catch {
    return { error: 'network' };
  }
}

/**
 * Moves an existing booking to a new time.
 *
 * This is an update, not a new row: the customer keeps their reference, the
 * salon sees one appointment that moved rather than two, and the prices agreed
 * on the original day stay snapshotted on the items untouched.
 *
 * It goes through `reschedule_booking()` (0008) rather than a plain update,
 * because now that every booking has a staff member somebody has to decide
 * whether the move keeps that person. If the customer named them it does; if
 * they took "any professional" the function re-picks whoever is free, so an
 * unrequested booking is not quietly narrowed to one diary.
 */
export async function rescheduleBooking(
  bookingId: string,
  date: Date,
  time: string,
  durationMs: number,
): Promise<{ ok: true } | { error: BookingFailure }> {
  if (!supabase) return { error: 'notConfigured' };

  const start = startsAt(date, time);
  if (Number.isNaN(start.getTime())) return { error: 'noSlot' };
  // The length comes off the booking itself, inside the function — the caller's
  // duration is no longer used, and is kept in the signature only so the call
  // sites read the same.
  void durationMs;

  try {
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking_id: bookingId,
      p_starts_at: start.toISOString(),
    });

    if (error) return { error: bookingFailure(error) };
    return { ok: true };
  } catch {
    return { error: 'network' };
  }
}

/**
 * Cancels a booking. The row stays — it is history, and the salon needs to see
 * that it happened — but `cancelled` is outside the no-double-booking
 * constraint, so the slot is immediately bookable by somebody else.
 */
export async function cancelBooking(
  bookingId: string,
): Promise<{ ok: true } | { error: BookingFailure }> {
  if (!supabase) return { error: 'notConfigured' };
  try {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId);
    return error ? { error: 'network' } : { ok: true };
  } catch {
    return { error: 'network' };
  }
}

/** A booking row joined to its items and salon, as the screens want it. */
interface JoinedBooking extends BookingRow {
  booking_items: BookingItemRow[];
  salons: { name_en: string; name_ar: string } | null;
  staff: { name_en: string; name_ar: string } | null;
}

const TILES = [tile.taupeMid, tile.sandMid, tile.blush, tile.stone];



const ANY_PROFESSIONAL = { en: 'Any professional', ar: 'أي مختص' };

function mapBooking(row: JoinedBooking, index: number): Booking {
  const items = row.booking_items ?? [];
  return {
    id: row.id,
    reference: row.reference,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tile: TILES[index % TILES.length],
    salon: row.salons?.name_en ?? '',
    salonAr: row.salons?.name_ar ?? '',
    salonId: row.salon_id,
    // Straight from the snapshot, never looked up again.
    services: items.map((item) => item.name_en).join(' · '),
    servicesAr: items.map((item) => item.name_ar).join(' · '),
    // Both languages are written now rather than formatted at render, so a
    // booking card matches the paired *_en / *_ar shape everything else uses.
    when: instantLabel(row.starts_at, 'en'),
    whenAr: instantLabel(row.starts_at, 'ar'),
    staff: row.staff?.name_en ?? ANY_PROFESSIONAL.en,
    staffAr: row.staff?.name_ar ?? ANY_PROFESSIONAL.ar,
    status:
      row.status === 'cancelled'
        ? 'CANCELLED'
        : row.status === 'completed'
          ? 'COMPLETED'
          : 'CONFIRMED',
    totalHalalas: row.total_halalas,
  };
}

/**
 * The signed-in customer's bookings, newest first. RLS restricts this to their
 * own rows, so there is no user filter here — asking for somebody else's would
 * simply return nothing.
 */
export async function loadMyBookings(): Promise<Booking[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, reference, salon_id, staff_id, starts_at, ends_at, status, total_halalas,' +
        ' booking_items (name_en, name_ar, duration_minutes, unit_price_halalas,' +
        ' discount_percent, quantity),' +
        ' salons (name_en, name_ar), staff (name_en, name_ar)',
    )
    .order('starts_at', { ascending: false })
    .returns<JoinedBooking[]>();

  if (error || !data) return [];
  return data.map(mapBooking);
}

/**
 * Split for the two tabs. A booking is "past" once its start time has gone —
 * and a cancelled one is past whatever its date says, because it is no longer
 * something the customer is expected to turn up to.
 */
export function splitByTime(bookings: Booking[]): { upcoming: Booking[]; past: Booking[] } {
  const now = Date.now();
  const upcoming: Booking[] = [];
  const past: Booking[] = [];
  for (const booking of bookings) {
    const at = booking.startsAt ? new Date(booking.startsAt).getTime() : NaN;
    if (booking.status === 'CANCELLED') past.push(booking);
    else if (Number.isNaN(at) || at >= now) upcoming.push(booking);
    else past.push(booking);
  }
  // Soonest first is what somebody checking their next appointment wants.
  upcoming.reverse();
  return { upcoming, past };
}
