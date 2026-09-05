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
  /** The rest of the business profile, as the owner filled it in. */
  profile: SalonDraft;
  /** Spacing between the times the booking screen offers. */
  slotStepMinutes: number;
  /** Whether the salon takes a waitlist at all. */
  waitlistEnabled: boolean;
  /** Always seven entries, Sunday first, so the editor can render a full week. */
  hours: DayHours[];
  /**
   * The owner's own catalogue. Loaded here rather than taken from the shared
   * catalogue because that one only fetches *published* salons — an owner
   * still setting up would otherwise see an empty list of their own services.
   */
  services: OwnerService[];
  staff: OwnerStaff[];
}

/** The owner's view of a service: the customer's shape plus the Live switch. */
export interface OwnerService extends Service {
  /** False when hidden from customers. Archived rows are not loaded at all. */
  isActive: boolean;
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
function mapOwnerService(row: ServiceRow): OwnerService {
  return {
    isActive: row.is_active ?? true,
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
      // No cr_number: 0015 revoked SELECT on it from every role, because the
      // catalogue's `select *` was handing each salon's commercial registration
      // number to anonymous visitors. The owner's own comes back from
      // my_salon_cr() below.
      .select('id, name_en, name_ar, category_en, category_ar, area_en, area_ar, city, phone, is_verified, is_published, slot_step_minutes, waitlist_enabled')
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

    // The one column no role may select (0015). It answers null for a salon you
    // do not own, so a failure here loses the number rather than the salon —
    // the business profile then shows an empty field, which is also what a
    // salon that never gave one looks like.
    //
    // Raced like every other read in this function: supabase-js retries four
    // times internally and an unreachable backend would otherwise hold the
    // whole portal open. And read defensively — an RPC returning `text` gives a
    // string, but the first version of this trusted that, and a stub answering
    // `[]` put an array where a string belonged and took the portal down on
    // render. `String.prototype.trim` on an array is not a subtle failure.
    const cr = await Promise.race([
      supabase.rpc('my_salon_cr', { p_salon_id: row.id }),
      expiry,
    ]).catch(() => null);
    const crNumber = typeof cr?.data === 'string' ? cr.data : '';

    // is_salon_owner() lets an owner read these whatever their published or
    // archived state, so this is the full catalogue as the owner knows it.
    const [servicesResult, staffResult] = await Promise.all([
      supabase
        .from('services')
        .select('id, name_en, name_ar, duration_minutes, price_halalas, discount_percent, is_active')
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
        profile: {
          nameEn: row.name_en,
          nameAr: row.name_ar,
          categoryEn: row.category_en ?? '',
          categoryAr: row.category_ar ?? '',
          areaEn: row.area_en ?? '',
          areaAr: row.area_ar ?? '',
          city: row.city ?? '',
          crNumber,
          phone: row.phone ?? '',
        },
        slotStepMinutes: row.slot_step_minutes ?? 30,
        waitlistEnabled: row.waitlist_enabled ?? true,
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
/** Turns the salon's waitlist on or off. 0004 grants this column to the owner. */
export async function saveWaitlistEnabled(
  salonId: string,
  enabled: boolean,
): Promise<OwnerWriteFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase
    .from('salons')
    .update({ waitlist_enabled: enabled })
    .eq('id', salonId);
  if (!error) return null;
  return error.code === '42501' ? 'notOwner' : 'network';
}

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
      // Neither is sent any more: 0015 revoked INSERT on them, so sending even
      // `false` is refused outright. The column defaults are false, which is
      // the same registration this always made — and now the *only* one it can
      // make. Sending them was how the audit found the hole: the app could
      // only have written those columns if they were writable.
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

/* ---------------------------------------------------------------------------
 * The salon's own catalogue: services and team.
 *
 * A salon that has just registered has neither, so until now a real sign-up
 * could set its hours and then stop — the menu customers book from still had
 * to be typed into the database by hand.
 *
 * Nothing here is `security definer`. `services_write` and `staff_write` are
 * already scoped to `is_salon_owner(salon_id)`, so the policies refuse a write
 * aimed at somebody else's salon whatever the app sends.
 * ------------------------------------------------------------------------- */

export interface ServiceDraft {
  nameEn: string;
  nameAr: string;
  /** Whole riyals as the owner types them; stored as halalas. */
  price: number;
  durationMinutes: number;
  discountPercent: number;
}

export interface StaffDraft {
  nameEn: string;
  nameAr: string;
  roleEn: string;
  roleAr: string;
}

export type CatalogFailure =
  | 'notConfigured'
  | 'missingName'
  | 'badDuration'
  | 'badPrice'
  | 'badDiscount'
  | 'notOwner'
  | 'network';

/** Maps Postgres' complaint back to the field the owner can actually fix. */
function writeFailure(error: { code?: string; message?: string } | null): CatalogFailure {
  if (!error) return 'network';
  if (error.code === '42501') return 'notOwner';
  if (error.code === '23514') {
    // The three check constraints on services, told apart by their names.
    if (/duration/i.test(error.message ?? '')) return 'badDuration';
    if (/discount/i.test(error.message ?? '')) return 'badDiscount';
    return 'badPrice';
  }
  return 'network';
}

function validateService(draft: ServiceDraft): CatalogFailure | null {
  if (!draft.nameEn.trim() || !draft.nameAr.trim()) return 'missingName';
  // Mirrors the schema's own bounds, so the owner is told before the round trip.
  if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes < 5 || draft.durationMinutes > 600) {
    return 'badDuration';
  }
  if (!Number.isFinite(draft.price) || draft.price < 0) return 'badPrice';
  if (!Number.isFinite(draft.discountPercent) || draft.discountPercent < 0 || draft.discountPercent > 100) {
    return 'badDiscount';
  }
  return null;
}

function serviceRow(salonId: string, draft: ServiceDraft) {
  return {
    salon_id: salonId,
    name_en: draft.nameEn.trim(),
    name_ar: draft.nameAr.trim(),
    duration_minutes: Math.round(draft.durationMinutes),
    // Money is integer halalas throughout. Never floats.
    price_halalas: Math.round(draft.price * 100),
    discount_percent: Math.round(draft.discountPercent),
  };
}

export async function addService(
  salonId: string,
  draft: ServiceDraft,
): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  const invalid = validateService(draft);
  if (invalid) return invalid;

  const { error } = await supabase.from('services').insert(serviceRow(salonId, draft));
  return error ? writeFailure(error) : null;
}

export async function updateService(
  salonId: string,
  serviceId: string,
  draft: ServiceDraft,
): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  const invalid = validateService(draft);
  if (invalid) return invalid;

  const { salon_id: _ignored, ...fields } = serviceRow(salonId, draft);
  const { error } = await supabase
    .from('services')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', serviceId);
  return error ? writeFailure(error) : null;
}

/**
 * Archives rather than deletes. Bookings reference services, and a past booking
 * must keep meaning what it meant — the schema says so on the column itself.
 */
export async function archiveService(serviceId: string): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase
    .from('services')
    .update({ is_archived: true, is_active: false })
    .eq('id', serviceId);
  return error ? writeFailure(error) : null;
}

/** The Live / Hidden switch: hides a service from customers without losing it. */
export async function setServiceActive(
  serviceId: string,
  isActive: boolean,
): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase
    .from('services')
    .update({ is_active: isActive })
    .eq('id', serviceId);
  return error ? writeFailure(error) : null;
}

/** Two letters from the name, which is what the avatar circles show. */
function initialsFrom(nameEn: string, nameAr: string): string {
  const source = nameEn.trim() || nameAr.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function staffRow(salonId: string, draft: StaffDraft) {
  return {
    salon_id: salonId,
    name_en: draft.nameEn.trim(),
    name_ar: draft.nameAr.trim(),
    role_en: draft.roleEn.trim(),
    role_ar: draft.roleAr.trim(),
    initials: initialsFrom(draft.nameEn, draft.nameAr),
  };
}

export async function addStaff(salonId: string, draft: StaffDraft): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  if (!draft.nameEn.trim() || !draft.nameAr.trim()) return 'missingName';

  const { error } = await supabase.from('staff').insert(staffRow(salonId, draft));
  return error ? writeFailure(error) : null;
}

export async function updateStaff(
  salonId: string,
  staffId: string,
  draft: StaffDraft,
): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  if (!draft.nameEn.trim() || !draft.nameAr.trim()) return 'missingName';

  const { salon_id: _ignored, ...fields } = staffRow(salonId, draft);
  const { error } = await supabase
    .from('staff')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', staffId);
  return error ? writeFailure(error) : null;
}

/** Archived, not deleted: bookings name the staff member who did the work. */
export async function archiveStaff(staffId: string): Promise<CatalogFailure | null> {
  if (!supabase) return 'notConfigured';
  const { error } = await supabase
    .from('staff')
    .update({ is_archived: true, is_active: false })
    .eq('id', staffId);
  return error ? writeFailure(error) : null;
}

/**
 * Updates the business profile — everything the owner told us at registration.
 *
 * `is_verified` and `is_published` are deliberately absent, and not merely
 * omitted here: migration 0004 revokes the owner's UPDATE privilege on both
 * columns, so a salon cannot approve itself even if this function is bypassed.
 *
 * Changing the CR number does **not** silently un-verify the salon. It is the
 * number a human checked, so a change is worth someone looking at again — but
 * quietly pulling a working salon out of the catalogue would be worse than
 * saying so, and only an admin can move those flags now anyway.
 */
export async function saveProfile(
  salonId: string,
  draft: SalonDraft,
): Promise<RegisterFailure | null> {
  if (!supabase) return 'notConfigured';
  if (!draft.nameEn.trim() || !draft.nameAr.trim()) return 'missingName';
  if (!draft.crNumber.trim()) return 'missingCr';

  const { error } = await supabase
    .from('salons')
    .update({
      name_en: draft.nameEn.trim(),
      name_ar: draft.nameAr.trim(),
      category_en: draft.categoryEn.trim(),
      category_ar: draft.categoryAr.trim(),
      area_en: draft.areaEn.trim(),
      area_ar: draft.areaAr.trim(),
      city: draft.city.trim() || 'Riyadh',
      cr_number: draft.crNumber.trim(),
      phone: draft.phone.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', salonId);

  return error ? 'network' : null;
}
