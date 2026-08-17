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
  | 'network';

/** A reference a human can read out over the phone. */
function newReference(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const noise = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `SL-${stamp}${noise}`;
}

/** The exact stored price, falling back to the display price for demo rows. */
function halalasOf(service: Service): number {
  return service.priceHalalas ?? service.price * 100;
}

function minutesOf(service: Service): number {
  if (service.durationMinutes != null) return service.durationMinutes;
  const parsed = Number.parseInt(service.dur, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45;
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
 * Writes the booking and its line items.
 *
 * The two inserts are not a transaction — supabase-js speaks REST, which has no
 * way to open one. If the items fail the booking is deleted again, so a booking
 * never survives with no services on it. That compensation can itself fail, in
 * which case the orphan is left and reported rather than hidden; moving both
 * inserts into a Postgres function is the real fix and is recorded in ROADMAP.
 */
export async function createBooking(
  draft: BookingDraft,
  customerId: string,
): Promise<{ reference: string } | { error: BookingFailure }> {
  if (!supabase) return { error: 'notConfigured' };
  if (!customerId) return { error: 'notSignedIn' };
  if (draft.services.length === 0) return { error: 'noServices' };

  const start = startsAt(draft.date, draft.time);
  if (Number.isNaN(start.getTime())) return { error: 'noSlot' };

  const minutes = draft.services.reduce((sum, service) => sum + minutesOf(service), 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  const totals = totalsFor(draft.services);
  const reference = newReference();

  try {
    const { data, error } = await supabase
      .from('bookings')
      .insert({
        reference,
        customer_id: customerId,
        salon_id: draft.salonId,
        staff_id: draft.staffId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'confirmed',
        subtotal_halalas: totals.subtotalHalalas,
        discount_halalas: totals.discountHalalas,
        vat_halalas: totals.vatHalalas,
        total_halalas: totals.totalHalalas,
        vat_rate: VAT_RATE,
        payment_method: draft.paymentMethod,
        // Deliberately not set: no money has actually moved. Checkout is
        // simulated, and claiming otherwise would put a lie in the invoice.
        paid_at: null,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) {
      // The exclusion constraint fires when someone else took the slot first.
      const conflict = error?.code === '23P01' || /exclusion|overlap/i.test(error?.message ?? '');
      return { error: conflict ? 'slotTaken' : 'network' };
    }

    const items = draft.services.map((service) => ({
      booking_id: data.id,
      service_id: service.priceHalalas != null ? service.id : null,
      name_en: service.name,
      name_ar: service.ar,
      duration_minutes: minutesOf(service),
      unit_price_halalas: halalasOf(service),
      discount_percent: service.discount,
      quantity: 1,
    }));

    const { error: itemsError } = await supabase.from('booking_items').insert(items);
    if (itemsError) {
      await supabase.from('bookings').delete().eq('id', data.id);
      return { error: 'network' };
    }

    return { reference };
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

/** Formats an instant back into the "Sat, Aug 2 · 4:00 PM" the cards show. */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Riyadh',
  });
  const time = at.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Riyadh',
  });
  return `${day} · ${time}`;
}

const ANY_PROFESSIONAL = { en: 'Any professional', ar: 'أي مختص' };

function mapBooking(row: JoinedBooking, index: number): Booking {
  const items = row.booking_items ?? [];
  return {
    id: row.id,
    reference: row.reference,
    startsAt: row.starts_at,
    tile: TILES[index % TILES.length],
    salon: row.salons?.name_en ?? '',
    salonAr: row.salons?.name_ar ?? '',
    salonId: row.salon_id,
    // Straight from the snapshot, never looked up again.
    services: items.map((item) => item.name_en).join(' · '),
    servicesAr: items.map((item) => item.name_ar).join(' · '),
    when: whenLabel(row.starts_at),
    staff: row.staff?.name_en ?? ANY_PROFESSIONAL.en,
    staffAr: row.staff?.name_ar ?? ANY_PROFESSIONAL.ar,
    status: row.status === 'completed' ? 'COMPLETED' : 'CONFIRMED',
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

/** Split for the two tabs. A booking is "past" once its start time has gone. */
export function splitByTime(bookings: Booking[]): { upcoming: Booking[]; past: Booking[] } {
  const now = Date.now();
  const upcoming: Booking[] = [];
  const past: Booking[] = [];
  for (const booking of bookings) {
    const at = booking.startsAt ? new Date(booking.startsAt).getTime() : NaN;
    if (Number.isNaN(at) || at >= now) upcoming.push(booking);
    else past.push(booking);
  }
  // Soonest first is what somebody checking their next appointment wants.
  upcoming.reverse();
  return { upcoming, past };
}
