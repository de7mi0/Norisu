import type { Salon } from '../types';
import { tile } from '../theme';

export const SALONS: Salon[] = [
  {
    id: 'maison',
    name: 'Maison Noir',
    ar: 'ميزون نوار',
    tags: 'Hair · Skin · Bridal',
    cat: 'Ladies salon',
    rating: 4.9,
    reviews: 1204,
    distance: '0.8 km',
    area: 'Al Olaya, Riyadh',
    arArea: 'العليا، الرياض',
    discount: 20,
    priceFrom: 150,
    tile: tile.sand,
  },
  {
    id: 'barber',
    name: 'The Barber Atelier',
    ar: 'ذا باربر',
    tags: 'Barber · Beard',
    cat: 'Men salon',
    rating: 4.8,
    reviews: 512,
    distance: '1.2 km',
    area: 'King Fahd Rd, Riyadh',
    arArea: 'طريق الملك فهد، الرياض',
    discount: 15,
    priceFrom: 80,
    tile: tile.taupe,
  },
  {
    id: 'rose',
    name: 'Rose & Oud',
    ar: 'وردة وعود',
    tags: 'Ladies · Skin · Nails',
    cat: 'Ladies salon',
    rating: 5.0,
    reviews: 328,
    distance: '2.0 km',
    area: 'Al Nakheel, Riyadh',
    arArea: 'النخيل، الرياض',
    discount: 25,
    priceFrom: 120,
    tile: tile.blush,
  },
  {
    id: 'kingdom',
    name: 'Kingdom Cuts',
    ar: 'كينغدم كتس',
    tags: 'Men · Barber · Beard',
    cat: 'Men salon',
    rating: 4.7,
    reviews: 876,
    distance: '1.5 km',
    area: 'Al Malaz, Riyadh',
    arArea: 'الملز، الرياض',
    discount: 0,
    priceFrom: 80,
    tile: tile.stone,
  },
];

/** Phone number shown when a customer taps "Call" on a salon. */
export const SALON_PHONE = '+966 11 200 4477';

/** Category filter chips on the home screen: [id, Arabic label]. */
export const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['All', 'الكل'],
  ['Hair', 'شعر'],
  ['Nails', 'أظافر'],
  ['Skin', 'بشرة'],
  ['Barber', 'حلاقة'],
  ['Bridal', 'عرائس'],
];

export function findSalon(id: string): Salon {
  return SALONS.find((salon) => salon.id === id) ?? SALONS[0];
}

export function matchesCategory(salon: Salon, category: string): boolean {
  if (category === 'All') return true;
  return `${salon.tags} ${salon.cat}`.toLowerCase().includes(category.toLowerCase());
}
