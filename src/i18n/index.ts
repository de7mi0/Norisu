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
  CANCELLED: 'ملغي',
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

/**
 * The locale dates are formatted in.
 *
 * `-ca-gregory` because Saudi locales otherwise default to the Umm al-Qura
 * (Hijri) calendar, and the salons' opening hours and bookings are all Gregorian.
 *
 * `-nu-latn` because the rest of the app writes numbers in Latin digits —
 * prices ("150 ر.س"), appointment times ("14:30"), the day numbers in the date
 * strip. Without it Arabic dates alone would come back in Arabic-Indic digits
 * ("١٩ أغسطس") and the same screen would show two numbering systems at once.
 */
function dateLocale(lang: Lang): string {
  return lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US';
}

/** The salon's clock. Saudi Arabia does not observe daylight saving. */
const RIYADH = 'Asia/Riyadh';

/**
 * "August 2026" / "أغسطس 2026" for the calendar heading. Derived from the date
 * being shown rather than written into the dictionaries, which had it frozen at
 * "July 2026" from the prototype.
 */
export function monthLabel(date: Date, lang: Lang): string {
  return date.toLocaleDateString(dateLocale(lang), {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The seeded vendor week strip stores weekdays as "MON"/"TUE" rather than
 * dates, so they cannot go through Intl. Short forms for the narrow strip
 * buttons, full ones for the heading beneath.
 */
const WEEKDAY_CODES: Record<string, { short: string; long: string }> = {
  SUN: { short: 'أحد', long: 'الأحد' },
  MON: { short: 'إثنين', long: 'الإثنين' },
  TUE: { short: 'ثلاثاء', long: 'الثلاثاء' },
  WED: { short: 'أربعاء', long: 'الأربعاء' },
  THU: { short: 'خميس', long: 'الخميس' },
  FRI: { short: 'جمعة', long: 'الجمعة' },
  SAT: { short: 'سبت', long: 'السبت' },
};

export function weekdayFromCode(code: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  if (lang !== 'ar') return `${code.charAt(0)}${code.slice(1).toLowerCase()}`;
  return WEEKDAY_CODES[code]?.[style] ?? code;
}

/** "Wed" / "الأربعاء" — the weekday above each date in the booking strip. */
export function weekdayLabel(date: Date, lang: Lang): string {
  return date.toLocaleDateString(dateLocale(lang), { weekday: 'short' });
}

/** "Wed, Aug 19" / "الأربعاء، 19 أغسطس" — the chosen day, in summaries. */
export function dayLabel(date: Date, lang: Lang): string {
  return date.toLocaleDateString(dateLocale(lang), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * "Sat, Aug 2 · 4:00 PM" / "السبت، 2 أغسطس · 4:00 م" — an instant on a booking
 * card, always read in the salon's own time zone rather than the visitor's.
 */
export function instantLabel(iso: string, lang: Lang): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString(dateLocale(lang), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: RIYADH,
  });
  const time = at.toLocaleTimeString(dateLocale(lang), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: RIYADH,
  });
  return `${day} · ${time}`;
}
