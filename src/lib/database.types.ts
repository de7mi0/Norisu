/**
 * Row shapes for the tables this app reads, mirroring supabase/migrations/.
 *
 * Only the columns the app actually uses are listed. If you change the schema,
 * change these to match — or regenerate the full set with the Supabase CLI:
 *   supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 */

/** The signed-in user's own row. Created by a trigger on `auth.users`. */
export interface UserProfileRow {
  id: string;
  role: 'customer' | 'vendor' | 'admin';
  full_name: string;
  phone: string | null;
  locale: string;
}

export interface SalonRow {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  tags_en: string;
  tags_ar: string;
  category_en: string;
  category_ar: string;
  area_en: string;
  area_ar: string;
  phone: string | null;
  is_published: boolean;
}

export interface ServiceRow {
  id: string;
  salon_id: string;
  name_en: string;
  name_ar: string;
  duration_minutes: number;
  price_halalas: number;
  discount_percent: number;
  is_active: boolean;
  is_archived: boolean;
  sort_order: number;
}

export interface StaffRow {
  id: string;
  salon_id: string;
  name_en: string;
  name_ar: string;
  role_en: string;
  role_ar: string;
  initials: string;
  is_active: boolean;
  is_archived: boolean;
  sort_order: number;
}

export interface BookingRow {
  id: string;
  reference: string;
  salon_id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  total_halalas: number;
}

/** The price snapshot. Deliberately a copy, never a lookup — see data/bookings.ts. */
export interface BookingItemRow {
  name_en: string;
  name_ar: string;
  duration_minutes: number;
  unit_price_halalas: number;
  discount_percent: number;
  quantity: number;
}

export interface SalonRatingRow {
  salon_id: string;
  rating: number | null;
  review_count: number | null;
}

/** One row of available_slots() — see supabase/migrations/0003_availability.sql. */
export interface AvailableSlotRow {
  slot_at: string;
  is_free: boolean;
  /** How many staff are still free; 0 when the slot is gone. */
  staff_free: number;
}
