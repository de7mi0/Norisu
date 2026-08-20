/**
 * The salon the signed-in user actually owns.
 *
 * The vendor portal has always shown one hardcoded demo salon to everybody,
 * signed in or not. That was harmless while nothing there was real, but the
 * booking screen now obeys per-salon opening hours and slot spacing, and an
 * owner needs to change their own — so the portal first has to know whose
 * salon it is looking at.
 *
 * Row-level security already answers the question: `salons_select_published`
 * lets an owner read their own salon whether or not it is published, and
 * `salons_update_own` lets them write it. Nothing here needs to be
 * `security definer`; the policies do the work.
 */
import { supabase } from '../lib/supabase';
import type { ServiceRow, StaffRow, SalonRow, WorkingHoursRow } from '../lib/database.types';
import type { Service } from '../types';

/** Opening hours for one weekday, as the owner edits them. */
export interface DayHours {
  /** 0 = Sunday, matching Postgres' extract(dow) and the working_hours column. */
  dayOfWeek: number;
  /** "10:00" — null when the salon is closed that day. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface OwnerSalon {
  id: string;
  name: string;
  nameAr: string;
  isVerified: boolean;
  isPublished: boolean;
  /** Spacing between the times the booking screen offers. */
  slotStepMinutes: number;
  /** Always seven entries, Sunday first, so the editor can render a full week. */
  hours: DayHours[];
  /**
   * The owner's own catalogue. Loaded here rather than taken from the shared
   * catalogue because that one only fetches *published* salons — an owner
   * still setting up would otherwise see an empty list of their own services.
   */
  services: Service[];
  staff: OwnerStaff[];
}

export interface OwnerStaff {
  id: string;
  name: string;
  nameAr: string;
  role: string;
  roleAr: string;
  initials: string;
  isActive: boolean;
}

/**
 * `unavailable` — no backend, so ownership cannot be established at all
 * `loading`     — asking
 * `signedOut`   — nobody is signed in
 * `none`        — signed in, but this account owns no salon
 * `live`        — `salon` is theirs
 * `error`       — the read failed
 */
export type OwnerStatus =
  | 'unavailable'
  | 'loading'
  | 'signedOut'
  | 'none'
  | 'live'
  | 'error';

export interface OwnerState {
  status: OwnerStatus;
  salon: OwnerSalon | null;
}

/** Same reasoning as the catalogue: supabase-js retries internally. */
const LOAD_TIMEOUT_MS = 6000;

/** Postgres `time` comes back as "10:00:00"; the editor wants "10:00". */
function toHourMinute(value: string): string {
  return value.slice(0, 5);
}

/** A full week, so a day with no row reads as closed rather than missing. */
function weekFrom(rows: WorkingHoursRow[]): DayHours[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    // Salon-level hours only. Per-staff rows exist in the schema and the
    // booking function honours them, but there is no per-staff editor yet.
    const row = rows.find((r) => r.day_of_week === dayOfWeek && r.staff_id === null);
    return {
      dayOfWeek,
      opensAt: row ? toHourMinute(row.opens_at) : null,
      closesAt: row ? toHourMinute(row.closes_at) : null,
    };
  });
}

/** Same conversions the customer-side catalogue makes: halalas → riyals, minutes → label. */
function mapOwnerService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name_en,
    ar: row.name_ar,
    dur: `${row.duration_minutes} min`,
    price: Math.round(row.price_halalas / 100),
    discount: row.discount_percent,
    priceHalalas: row.price_halalas,
    durationMinutes: row.duration_minutes,
  };
}

function mapOwnerStaff(row: StaffRow): OwnerStaff {
  return {
    id: row.id,
    name: row.name_en,
    nameAr: row.name_ar,
    role: row.role_en,
    roleAr: row.role_ar,
    initials: row.initials,
    isActive: row.is_active,
  };
}

/**
 * Reads the signed-in user's salon. Never throws — owning no salon is an
 * ordinary state for anyone who signed in to book rather than to sell.
 */
export async function loadMySalon(userId: string): Promise<OwnerState> {
  if (!supabase) return { status: 'unavailable', salon: null };
  if (!userId) return { status: 'signedOut', salon: null };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);
  });

  try {
    const salonCall = supabase
      .from('salons')
      .select('id, name_en, name_ar, is_verified, is_published, slot_step_minutes')
      .eq('owner_id', userId)
      // One salon per owner for now; the schema permits more.
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: salons, error } = await Promise.race([salonCall, expiry]);
    if (error) return { status: 'error', salon: null };

    const row = (salons ?? [])[0] as SalonRow | undefined;
    if (!row) return { status: 'none', salon: null };

    const hoursCall = supabase
      .from('working_hours')
      .select('staff_id, day_of_week, opens_at, closes_at')
      .eq('salon_id', row.id);

    const { data: hours, error: hoursError } = await Promise.race([hoursCall, expiry]);
    if (hoursError) return { status: 'error', salon: null };

    // is_salon_owner() lets an owner read these whatever their published or
    // archived state, so this is the full catalogue as the owner knows it.
    const [servicesResult, staffResult] = await Promise.all([
      supabase
        .from('services')
        .select('id, name_en, name_ar, duration_minutes, price_halalas, discount_percent')
        .eq('salon_id', row.id)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true }),
      supabase
        .from('staff')
        .select('id, name_en, name_ar, role_en, role_ar, initials, is_active')
        .eq('salon_id', row.id)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true }),
    ]);

    return {
      status: 'live',
      salon: {
        id: row.id,
        name: row.name_en,
        nameAr: row.name_ar,
        isVerified: Boolean(row.is_verified),
        isPublished: Boolean(row.is_published),
        slotStepMinutes: row.slot_step_minutes ?? 30,
        hours: weekFrom((hours ?? []) as WorkingHoursRow[]),
        services: ((servicesResult.data ?? []) as ServiceRow[]).map(mapOwnerService),
        staff: ((staffResult.data ?? []) as StaffRow[]).map(mapOwnerStaff),
      },
    };
  } catch {
    return { status: 'error', salon: null };
  } finally {
    clearTimeout(timeout);
  }
}

export type OwnerWriteFailure = 'notConfigured' | 'notOwner' | 'invalid' | 'network';

/**
 * Changes how far apart the booking screen's offered times sit. The database
 * constrains the value, so an unexpected one comes back as a failure rather
 * than being silently stored.
 */
export async function saveSlotStep(
  salonId: string,
  minutes: number,
): Promise<OwnerWriteFailure | null> {
  if (!supabase) return 'notConfigured';

  const { error } = await supabase
    .from('salons')
    .update({ slot_step_minutes: minutes })
    .eq('id', salonId);

  if (!error) return null;
  // 23514 is check_violation: a step the schema does not allow.
  if (error.code === '23514') return 'invalid';
  if (error.code === '42501') return 'notOwner';
  return 'network';
}

/**
 * Replaces one weekday's opening hours. Closing a day deletes its row, which
 * is what `available_slots()` reads as "not open" — distinct from a day whose
 * every slot is taken.
 */
export async function saveDayHours(
  salonId: string,
  day: DayHours,
): Promise<OwnerWriteFailure | null> {
  if (!supabase) return 'notConfigured';

  if (day.opensAt && day.closesAt && day.closesAt <= day.opensAt) return 'invalid';

  const { error: clearError } = await supabase
    .from('working_hours')
    .delete()
    .eq('salon_id', salonId)
    .eq('day_of_week', day.dayOfWeek)
    .is('staff_id', null);

  if (clearError) return clearError.code === '42501' ? 'notOwner' : 'network';

  // Closed: the absence of a row is the closure.
  if (!day.opensAt || !day.closesAt) return null;

  const { error } = await supabase.from('working_hours').insert({
    salon_id: salonId,
    staff_id: null,
    day_of_week: day.dayOfWeek,
    opens_at: day.opensAt,
    closes_at: day.closesAt,
  });

  if (!error) return null;
  if (error.code === '23514') return 'invalid';
  if (error.code === '42501') return 'notOwner';
  return 'network';
}

/** What the registration form collects. Bilingual where customers will see it. */
export interface SalonDraft {
  nameEn: string;
  nameAr: string;
  categoryEn: string;
  categoryAr: string;
  areaEn: string;
  areaAr: string;
  city: string;
  crNumber: string;
  phone: string;
}

export type RegisterFailure =
  | 'notConfigured'
  | 'notSignedIn'
  | 'missingName'
  | 'missingCr'
  | 'alreadyOwns'
  | 'network';

/**
 * A url-safe handle from the salon's name, with a short random tail because
 * `salons.slug` is unique and two "Rose & Oud"s are entirely likely.
 */
function slugFrom(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const tail = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${base || 'salon'}-${tail}`;
}

/**
 * A week the booking screen can already work with, so a new salon is not
 * "closed every day" the moment it is created. The owner changes it in
 * Hours & booking; Friday opens later, as most Saudi salons do.
 */
function defaultWeek(salonId: string) {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    salon_id: salonId,
    staff_id: null,
    day_of_week: dayOfWeek,
    opens_at: dayOfWeek === 5 ? '14:00' : '10:00',
    closes_at: '22:00',
  }));
}

/**
 * Registers a salon for the signed-in user.
 *
 * It is created **unverified and unpublished**: `published_salons_are_verified`
 * forbids publishing before verification, so a new salon can set itself up —
 * hours, services, team — while staying invisible to customers until its
 * commercial registration has been checked. That check is a human one for now.
 */
export async function createSalon(
  userId: string,
  draft: SalonDraft,
): Promise<{ salonId: string } | { error: RegisterFailure }> {
  if (!supabase) return { error: 'notConfigured' };
  if (!userId) return { error: 'notSignedIn' };
  if (!draft.nameEn.trim() || !draft.nameAr.trim()) return { error: 'missingName' };
  if (!draft.crNumber.trim()) return { error: 'missingCr' };

  // One salon per owner today. The schema permits more, but every screen in the
  // portal assumes one, so a second would silently never be shown.
  const existing = await loadMySalon(userId);
  if (existing.status === 'live') return { error: 'alreadyOwns' };

  const { data, error } = await supabase
    .from('salons')
    .insert({
      owner_id: userId,
      slug: slugFrom(draft.nameEn),
      name_en: draft.nameEn.trim(),
      name_ar: draft.nameAr.trim(),
      category_en: draft.categoryEn.trim(),
      category_ar: draft.categoryAr.trim(),
      area_en: draft.areaEn.trim(),
      area_ar: draft.areaAr.trim(),
      city: draft.city.trim() || 'Riyadh',
      cr_number: draft.crNumber.trim(),
      phone: draft.phone.trim() || null,
      is_verified: false,
      is_published: false,
    })
    .select('id')
    .limit(1);

  const row = (data ?? [])[0] as { id: string } | undefined;
  if (error || !row) return { error: 'network' };

  // Best effort: a salon with no hours still works, it just offers no times
  // until the owner sets them, so a failure here is not worth undoing the
  // registration over.
  await supabase.from('working_hours').insert(defaultWeek(row.id));

  return { salonId: row.id };
}
