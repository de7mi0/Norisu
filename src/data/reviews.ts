import type { Booking, ProfileRow, RatingBar, Review } from '../types';
import { tile } from '../theme';

export const REVIEWS: Review[] = [
  {
    initials: 'HA',
    name: 'Huda A.',
    arName: 'هدى ع.',
    date: '2 days ago',
    arDate: 'قبل يومين',
    service: 'Luxury Facial',
    arService: 'عناية فاخرة',
    rating: 5.0,
    text: 'Absolutely pristine. The private room and the attention to detail felt truly high-end. Booking Sara again for sure.',
    arText: 'نظيف تماماً. الغرفة الخاصة والاهتمام بالتفاصيل كانت راقية حقاً. سأحجز مع سارة مجدداً بالتأكيد.',
    tile: tile.sandFine,
  },
  {
    initials: 'MF',
    name: 'Mohammed F.',
    arName: 'محمد ف.',
    date: '1 week ago',
    arDate: 'قبل أسبوع',
    service: 'Signature Haircut',
    arService: 'قص شعر',
    rating: 4.5,
    text: 'Great cut and very professional staff. Slightly ran over time but the result was worth it.',
    arText: 'قصّة رائعة وطاقم محترف جداً. تأخر قليلاً عن الوقت لكن النتيجة تستحق.',
    tile: tile.taupeFine,
  },
  {
    initials: 'RS',
    name: 'Reem S.',
    arName: 'ريم س.',
    date: '2 weeks ago',
    arDate: 'قبل أسبوعين',
    service: 'Bridal Makeup',
    arService: 'مكياج عروس',
    rating: 5.0,
    text: 'They made my wedding day flawless. The team arrived early and everything was immaculate. Highly recommend.',
    arText: 'جعلوا يوم زفافي مثالياً. وصل الفريق مبكراً وكان كل شيء متقناً. أنصح بشدة.',
    tile: tile.blushFine,
  },
];

export const RATING_BARS: RatingBar[] = [
  { star: 5, pct: '86%' },
  { star: 4, pct: '9%' },
  { star: 3, pct: '3%' },
  { star: 2, pct: '1%' },
  { star: 1, pct: '1%' },
];

export const PROFILE_ROWS: ProfileRow[] = [
  // Personal details is real: the row shows and edits profiles.full_name.
  { label: 'Personal details', arLabel: 'البيانات الشخصية', value: '', arValue: '' },
  // "Saved salons 6" and "Payment methods 3 cards" used to sit here. Neither
  // feature exists — nothing is saved and no card is ever collected — and an
  // invented count next to a real name reads as though both were real.
  { label: 'Notifications', arLabel: 'الإشعارات', value: 'On', arValue: 'مفعّلة' },
  { label: 'Language', arLabel: 'اللغة', value: 'English', arValue: 'العربية' },
  { label: 'Help & support', arLabel: 'المساعدة والدعم', value: '', arValue: '' },
];

/** The customer's one pre-existing upcoming booking. */
export const INITIAL_BOOKINGS: Booking[] = [
  {
    tile: tile.taupeMid,
    salon: 'Rose & Oud',
    salonAr: 'وردة وعود',
    services: 'Luxury Facial · Manicure',
    servicesAr: 'عناية فاخرة · مانيكير',
    when: 'Sat, Aug 2 · 4:00 PM',
    whenAr: 'السبت، 2 أغسطس · 4:00 م',
    staff: 'Sara M.',
    staffAr: 'سارة م.',
    status: 'CONFIRMED',
  },
];

export const PAST_BOOKINGS: Booking[] = [
  {
    tile: tile.sandMid,
    salon: 'Maison Noir',
    salonAr: 'ميزون نوار',
    services: 'Signature Haircut',
    servicesAr: 'قص شعر',
    when: 'Sat, Jul 12 · 2:00 PM',
    whenAr: 'السبت، 12 يوليو · 2:00 م',
    staff: 'Layla A.',
    staffAr: 'ليلى ع.',
    status: 'COMPLETED',
  },
  {
    tile: tile.taupeMid,
    salon: 'The Barber Atelier',
    salonAr: 'ذا باربر',
    services: 'Beard Trim · Signature Haircut',
    servicesAr: 'تهذيب لحية · قص شعر',
    when: 'Mon, Jun 30 · 6:30 PM',
    whenAr: 'الاثنين، 30 يونيو · 6:30 م',
    staff: 'Omar K.',
    staffAr: 'عمر ك.',
    status: 'COMPLETED',
  },
];
