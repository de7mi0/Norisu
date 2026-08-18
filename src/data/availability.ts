/**
 * Which times a salon can actually take an appointment.
 *
 * The app used to offer nine hardcoded times to everybody, so it could hand a
 * customer a slot that was already booked and only discover it at checkout.
 * The real answer depends on the salon's opening hours, the length of the
 * chosen services and the appointments already in the book.
 *
 * That last part is why the work happens in Postgres rather than here. Row
 * level security deliberately stops a customer reading anybody else's
 * bookings — quite right, nobody should be able to enumerate a salon's client
 * list — so the browser cannot see what is taken. `available_slots()` is
 * `security definer`: it reads every booking but answers only free or taken.
 */
import { supabase } from '../lib/supabase';
import type { AvailableSlotRow } from '../lib/database.types';
import type { Service } from '../types';
import { DISABLED_SLOTS, FULLY_BOOKED_DATE_INDEX, SLOTS } from './services';

/** A time the screen can offer, already formatted for display. */
export interface Slot {
  /** "14:30" in Riyadh time — what the customer sees and what booking sends. */
  time: string;
  free: boolean;
}

export interface Availability {
  slots: Slot[];
  /**
   * `loading` — the answer is on its way.
   * `live`    — the salon's real diary.
   * `demo`    — sample times, because there is no backend configured.
   * `error`   — the query failed or timed out; sample times are shown instead.
   * `closed`  — the salon does not open on this day at all.
   */
  source: 'loading' | 'live' | 'demo' | 'error' | 'closed';
}

export interface AvailabilityQuery {
  salonId: string;
  /** Midnight on the chosen day, local time. */
  day: Date;
  services: Service[];
  /**
   * Overrides the length derived from `services`. Rescheduling keeps the
   * appointment's original duration, which no longer matches the current cart.
   */
  durationMinutes?: number;
  /** Null for "any professional". */
  staffId: string | null;
  /** The booking being moved, so it does not collide with itself. */
  excludeBookingId?: string | null;
}

/**
 * Same reasoning as the catalogue's timeout: supabase-js retries internally and
 * an unreachable database can otherwise sit silent for a long time.
 */
const LOAD_TIMEOUT_MS = 6000;

/** Saudi Arabia does not observe daylight saving, so this is stable. */
const RIYADH_TIME_ZONE = 'Asia/Riyadh';

const riyadhClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: RIYADH_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-08-25T07:00:00Z" → "10:00", the time as the salon reads a clock. */
function toRiyadhTime(iso: string): string {
  return riyadhClock.format(new Date(iso));
}

/** The calendar day in Riyadh, as the database's `date` parameter wants it. */
function toRiyadhDate(day: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
  return parts;
}

/** Exact stored duration where we have it, parsed from the label otherwise. */
function minutesOf(service: Service): number {
  if (service.durationMinutes != null) return service.durationMinutes;
  const parsed = Number.parseInt(service.dur, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45;
}

export function totalMinutes(services: Service[]): number {
  return services.reduce((sum, service) => sum + minutesOf(service), 0);
}

/**
 * The bundled sample grid, used when there is no backend to ask. Keeps the app
 * fully usable offline; the home screen already says the data is sample data.
 *
 * One day of the sample week is scripted as fully booked, because the waitlist
 * demo needs a day with nothing left on it. On live data a full day is simply
 * one where every slot came back taken — no script required.
 */
export function demoAvailability(dateIdx?: number): Availability {
  const full = dateIdx === FULLY_BOOKED_DATE_INDEX;
  return {
    slots: SLOTS.map((time, index) => ({
      time,
      free: full ? false : !DISABLED_SLOTS.includes(index),
    })),
    source: 'demo',
  };
}

/**
 * Asks the database what is free. Never throws: a salon that is closed, an
 * unreachable backend and a full day are all ordinary outcomes of opening a
 * booking screen, so each comes back as a value the screen can render.
 */
export async function loadAvailability(query: AvailabilityQuery): Promise<Availability> {
  if (!supabase) return demoAvailability();

  const minutes = query.durationMinutes ?? totalMinutes(query.services);
  if (minutes <= 0) return { slots: [], source: 'closed' };

  const serviceIds = query.services.map((service) => service.id).filter(Boolean);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);
  });

  try {
    const call = supabase
      .rpc('available_slots', {
        p_salon_id: query.salonId,
        p_day: toRiyadhDate(query.day),
        p_duration_minutes: minutes,
        p_staff_id: query.staffId,
        // Only real service rows constrain who can perform the work; demo ids
        // are not in staff_services and would rule everybody out.
        p_service_ids: serviceIds.length ? serviceIds : null,
        p_exclude_booking_id: query.excludeBookingId ?? null,
      });

    const { data, error } = await Promise.race([call, expiry]);
    if (error) return { ...demoAvailability(), source: 'error' };

    // The client is untyped on purpose (see lib/supabase.ts), so the shape is
    // asserted here rather than inferred.
    const rows = (data ?? []) as AvailableSlotRow[];

    // No rows means the salon does not open that day — a different thing from
    // being fully booked, and the screen says so differently.
    if (rows.length === 0) return { slots: [], source: 'closed' };

    return {
      slots: rows.map((row) => ({ time: toRiyadhTime(row.slot_at), free: row.is_free })),
      source: 'live',
    };
  } catch {
    return { ...demoAvailability(), source: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}
