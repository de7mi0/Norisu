import type { Service } from '../types';

export const SERVICES: Service[] = [
  { id: 's1', name: 'Signature Haircut', ar: 'قص شعر', dur: '45 min', price: 150, discount: 20 },
  { id: 's2', name: 'Hair Color & Gloss', ar: 'صبغة وتلوين', dur: '90 min', price: 320, discount: 0 },
  { id: 's3', name: 'Luxury Facial', ar: 'عناية فاخرة بالبشرة', dur: '60 min', price: 260, discount: 15 },
  { id: 's4', name: 'Manicure & Nail Art', ar: 'مانيكير', dur: '50 min', price: 120, discount: 0 },
  { id: 's5', name: 'Bridal Makeup', ar: 'مكياج عروس', dur: '120 min', price: 600, discount: 0 },
];

/** Bookable times of day. */
export const SLOTS = [
  '10:00',
  '11:30',
  '13:00',
  '14:30',
  '16:00',
  '17:30',
  '19:00',
  '20:30',
  '21:30',
] as const;

/** Slot indices that are already taken on a normal day. */
export const DISABLED_SLOTS = [2, 5];

/** The date offset (from today) that is fully booked and offers a waitlist. */
export const FULLY_BOOKED_DATE_INDEX = 4;

export const VAT_RATE = 0.15;

/** Discounted price, rounded to whole riyals as the prototype does. */
export function priceNow(service: Pick<Service, 'price' | 'discount'>): number {
  return service.discount ? Math.round(service.price * (1 - service.discount / 100)) : service.price;
}
