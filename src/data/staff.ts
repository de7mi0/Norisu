import type { StaffMember } from '../types';
import { tile } from '../theme';

export const STAFF: StaffMember[] = [
  {
    id: 'st1',
    name: 'Layla A.',
    arName: 'ليلى ع.',
    role: 'Senior Stylist',
    arRole: 'مصفّفة أولى',
    rating: 4.9,
    years: '8 yrs',
    initials: 'LA',
    tile: tile.sandFine,
  },
  {
    id: 'st2',
    name: 'Omar K.',
    arName: 'عمر ك.',
    role: 'Master Barber',
    arRole: 'حلّاق محترف',
    rating: 4.8,
    years: '6 yrs',
    initials: 'OK',
    tile: tile.taupeFine,
  },
  {
    id: 'st3',
    name: 'Sara M.',
    arName: 'سارة م.',
    role: 'Color & Skin Specialist',
    arRole: 'أخصائية صبغ وبشرة',
    rating: 5.0,
    years: '10 yrs',
    initials: 'SM',
    tile: tile.blushFine,
  },
  {
    id: 'st4',
    name: 'Any professional',
    arName: 'أي مختص',
    role: 'First available — no preference',
    arRole: 'أول متاح — بدون تفضيل',
    rating: null,
    years: '',
    initials: '✦',
    tile: tile.plain,
  },
];

export const ANY_PROFESSIONAL = { en: 'Any professional', ar: 'أي مختص' } as const;
