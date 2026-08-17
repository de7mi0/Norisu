export type Lang = 'en' | 'ar';

export type Mode = 'customer' | 'vendor';

export type CustomerScreen =
  | 'home'
  | 'salon'
  | 'staff'
  | 'time'
  | 'pay'
  | 'confirm'
  | 'reviews'
  | 'bookings'
  | 'profile'
  | 'chat'
  | 'bot';

export type VendorScreen =
  | 'v_onboard'
  | 'v_dash'
  | 'v_calendar'
  | 'v_services'
  | 'v_gallery'
  | 'v_staff'
  | 'v_reviews'
  | 'v_more'
  | 'v_waitlist';

export type Screen = CustomerScreen | VendorScreen;

export interface Salon {
  id: string;
  name: string;
  ar: string;
  tags: string;
  /** Set when the Arabic tags come from the database rather than translation. */
  tagsAr?: string;
  cat: string;
  /** As above, for the category label. */
  catAr?: string;
  /** Null for a salon with no reviews yet; the UI shows "New" instead of a score. */
  rating: number | null;
  reviews: number;
  /** Empty until the app asks for the customer's location. */
  distance: string;
  area: string;
  arArea: string;
  discount: number;
  priceFrom: number;
  tile: string;
}

export interface Service {
  id: string;
  name: string;
  ar: string;
  dur: string;
  /** Whole riyals, for display. Rounded — never write this back to the database. */
  price: number;
  discount: number;
  /**
   * The exact stored price in halalas, and the exact duration. Carried
   * untouched from the row so a booking snapshots what the salon actually
   * charges, not the rounded figure the screens show. Absent on demo data,
   * where there is no backend to book against anyway.
   */
  priceHalalas?: number;
  durationMinutes?: number;
}

export interface StaffMember {
  id: string;
  name: string;
  arName: string;
  role: string;
  arRole: string;
  rating: number | null;
  years: string;
  initials: string;
  tile: string;
}

export interface PayMethod {
  id: string;
  name: string;
  nameAr: string;
  sub?: string;
  subAr?: string;
  badge: string;
  badgeBg: string;
  badgeFg: string;
  badgeBd: string;
}

export interface Review {
  initials: string;
  name: string;
  arName: string;
  date: string;
  arDate: string;
  service: string;
  arService: string;
  rating: number;
  text: string;
  arText: string;
  tile: string;
}

export interface RatingBar {
  star: number;
  pct: string;
}

export interface ProfileRow {
  label: string;
  arLabel: string;
  value: string;
  arValue: string;
}

export interface Booking {
  tile: string;
  salon: string;
  salonAr: string;
  services: string;
  servicesAr: string;
  when: string;
  staff: string;
  staffAr: string;
  status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

  /** Set on bookings read back from the database; absent on demo rows. */
  id?: string;
  reference?: string;
  /** ISO instants. Used to sort, to split upcoming from past, and — for the
   *  pair — to keep an appointment's length when it is moved. */
  startsAt?: string;
  endsAt?: string;
  salonId?: string;
  totalHalalas?: number;
}

export interface VendorStat {
  label: string;
  arLabel: string;
  value: string;
  sub: string;
  arSub: string;
  accent: string;
}

export interface VendorAppointment {
  time: string;
  client: string;
  arClient: string;
  service: string;
  arService: string;
  staff: string;
  arStaff: string;
  status: string;
  arStatus: string;
  bg: string;
  bd: string;
  dot: string;
}

export interface VendorDay {
  dow: string;
  num: number;
}

export interface VendorService extends Service {
  bookings: string;
}

export interface VendorStaff {
  id: string;
  name: string;
  arName: string;
  role: string;
  arRole: string;
  rating: number | string;
  todayCount: string;
  initials: string;
  tile: string;
}

export interface GalleryItem {
  tile: string;
  cover?: boolean;
}

export interface VendorReview {
  initials: string;
  name: string;
  arName: string;
  date: string;
  arDate: string;
  rating: number;
  text: string;
  arText: string;
  reply: string;
  arReply: string;
  tile: string;
}

export interface OnboardField {
  label: string;
  arLabel: string;
  value: string;
  arValue: string;
}

export interface WaitlistEntry {
  name: string;
  arName: string;
  service: string;
  arService: string;
  date: string;
  arDate: string;
  pref: string;
  arPref: string;
  initials: string;
}

/**
 * A chat bubble. Messages the user typed carry `text`; scripted messages carry
 * an `en`/`ar` pair so they follow the active language.
 */
export interface ChatMessage {
  who: 'me' | 'salon' | 'bot';
  text?: string;
  en?: string;
  ar?: string;
}
