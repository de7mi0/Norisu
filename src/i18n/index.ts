import type { Lang } from '../types';
import { en, type Dictionary } from './en';
import { ar } from './ar';

export type { Dictionary };

const DICTIONARIES: Record<Lang, Dictionary> = { en, ar };

export function dictionaryFor(lang: Lang): Dictionary {
  return DICTIONARIES[lang];
}

/** Prices render as "SAR 150" in English and "150 ر.س" in Arabic. */
export function formatMoney(amount: number, lang: Lang): string {
  return lang === 'ar' ? `${amount} ر.س` : `SAR ${amount}`;
}

const TAG_TRANSLATIONS: Record<string, string> = {
  Hair: 'شعر',
  Skin: 'بشرة',
  Bridal: 'عرائس',
  Barber: 'حلاقة',
  Beard: 'لحية',
  Ladies: 'سيدات',
  Nails: 'أظافر',
  Men: 'رجال',
};

const CATEGORY_TRANSLATIONS: Record<string, string> = {
  'Ladies salon': 'صالون سيدات',
  'Men salon': 'صالون رجال',
};

const STATUS_TRANSLATIONS: Record<string, string> = {
  CONFIRMED: 'مؤكد',
  COMPLETED: 'مكتمل',
};

/** Translates a " · "-joined tag list, e.g. "Hair · Skin · Bridal". */
export function translateTags(tags: string, lang: Lang): string {
  if (lang !== 'ar') return tags;
  return tags
    .split(' · ')
    .map((tag) => TAG_TRANSLATIONS[tag] ?? tag)
    .join(' · ');
}

export function translateCategory(category: string, lang: Lang): string {
  return lang === 'ar' ? CATEGORY_TRANSLATIONS[category] ?? category : category;
}

/**
 * A salon's tags and category. Rows from the database carry their own Arabic
 * text, which is used in preference to translating the English — a salon may
 * write tags the lookup table has never seen.
 */
export function salonTags(
  salon: { tags: string; tagsAr?: string },
  lang: Lang,
): string {
  if (lang !== 'ar') return salon.tags;
  return salon.tagsAr || translateTags(salon.tags, 'ar');
}

export function salonCategory(
  salon: { cat: string; catAr?: string },
  lang: Lang,
): string {
  if (lang !== 'ar') return salon.cat;
  return salon.catAr || translateCategory(salon.cat, 'ar');
}

export function translateStatus(status: string, lang: Lang): string {
  return lang === 'ar' ? STATUS_TRANSLATIONS[status] ?? status : status;
}

/**
 * Localises the short English units that live inside seeded data strings
 * ("45 min", "8 yrs", "42 this month") without restructuring the data.
 */
export function localizeUnits(value: string, lang: Lang): string {
  if (lang !== 'ar' || !value) return value;
  return value
    .replace(/\bmin\b/g, 'دقيقة')
    .replace('this month', 'هذا الشهر')
    .replace(/\btoday\b/g, 'اليوم')
    .replace('yrs', 'سنة');
}
