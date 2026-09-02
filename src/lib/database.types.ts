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
  city?: string;
  cr_number?: string | null;
  /** Only read on the owner's own row, which RLS lets them see unpublished. */
  is_verified?: boolean;
  /** Spacing between the times the booking screen offers. Added in 0003. */
  slot_step_minutes?: number;
  /** Whether the salon takes a waitlist. Only read on the owner's own row. */
  waitlist_enabled?: boolean;
}

export interface SalonMediaRow {
  id: string;
  salon_id: string;
  storage_path: string;
  alt_text: string | null;
  is_cover: boolean;
  sort_order: number;
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
  /** True when the customer named a specialist; see migration 0008. */
  staff_requested?: boolean;
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

/** Opening hours. staff_id null means the salon's own hours. */
export interface WorkingHoursRow {
  staff_id: string | null;
  day_of_week: number;
  /** Postgres `time`, serialised as "10:00:00". */
  opens_at: string;
  closes_at: string;
}

/** One row of salon_day() — see supabase/migrations/0005_vendor_day.sql. */
export interface SalonDayRow {
  booking_id: string;
  reference: string;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  /** Null for "any professional" — no one is assigned yet. */
  staff_name_en: string | null;
  staff_name_ar: string | null;
  /** Null when the customer has not given a name. Nothing else about them crosses. */
  customer_name: string | null;
  /**
   * Only ever a number the salon typed itself, on a booking it wrote at the
   * counter. A customer's own phone number never crosses this boundary — see
   * migration 0014 and assertion 92.
   */
  customer_phone: string | null;
  /** True for a booking the salon wrote for somebody with no account. */
  is_walk_in: boolean;
  /** Snapshotted service names, in booking order. */
  services_en: string[] | null;
  services_ar: string[] | null;
  total_halalas: number;
}

/** The single row of salon_stats(). */
export interface SalonStatsRow {
  bookings_today: number;
  bookings_yesterday: number;
  /** bigint, so PostgREST sends it as a string. Value agreed, not taken. */
  booked_halalas: number | string;
  /** Null when the salon does not open that day. */
  occupancy_percent: number | null;
  is_open: boolean;
  /** Null until somebody reviews the salon; the tile then says "New". */
  rating: number | string | null;
  review_count: number | null;
}

/** One row of salon_reviews(). */
export interface SalonReviewRow {
  review_id: string;
  /** numeric(2,1), so PostgREST sends it as a string. */
  rating: number | string;
  body: string;
  reply: string;
  replied_at: string | null;
  is_published: boolean;
  created_at: string;
  customer_name: string | null;
}

/** One row of my_waitlist() — see supabase/migrations/0009_waitlist.sql. */
export interface MyWaitlistRow {
  entry_id: string;
  salon_id: string;
  salon_name_en: string;
  salon_name_ar: string;
  requested_date: string;
  earliest_time: string | null;
  latest_time: string | null;
  status: 'waiting' | 'offered' | 'claimed' | 'expired' | 'cancelled';
  offer_id: string | null;
  offer_starts_at: string | null;
  offer_expires_at: string | null;
  /** True when tapping would actually get them the seat. */
  claimable: boolean;
  service_names_en: string[] | null;
  service_names_ar: string[] | null;
}

/** One row of salon_waitlist(). */
export interface SalonWaitlistRow {
  entry_id: string;
  customer_name: string | null;
  requested_date: string;
  earliest_time: string | null;
  latest_time: string | null;
  status: 'waiting' | 'offered' | 'claimed' | 'expired' | 'cancelled';
  waiting_since: string;
  offer_id: string | null;
  offer_starts_at: string | null;
  offer_expires_at: string | null;
  /** False when somebody is queued behind them. */
  can_extend: boolean;
  service_names_en: string[] | null;
  service_names_ar: string[] | null;
}
