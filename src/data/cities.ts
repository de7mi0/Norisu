/**
 * The cities a salon can serve and a customer can browse, in both languages.
 *
 * The English name is what is stored (`salons.city` and `salons.cities`, 0023)
 * and what the customer's city filter compares, so it must never be
 * translated or re-spelled once salons exist under it — add a city, never
 * rename one. The Arabic is display only.
 *
 * Ordered by population rather than alphabetically, because the list is read
 * top-down on a phone and most people live in the first five.
 */
export interface City {
  id: string;
  ar: string;
}

export const CITIES: readonly City[] = [
  { id: 'Riyadh', ar: 'الرياض' },
  { id: 'Jeddah', ar: 'جدة' },
  { id: 'Makkah', ar: 'مكة المكرمة' },
  { id: 'Madinah', ar: 'المدينة المنورة' },
  { id: 'Dammam', ar: 'الدمام' },
  { id: 'Khobar', ar: 'الخبر' },
  { id: 'Dhahran', ar: 'الظهران' },
  { id: 'Taif', ar: 'الطائف' },
  { id: 'Tabuk', ar: 'تبوك' },
  { id: 'Buraydah', ar: 'بريدة' },
  { id: 'Unaizah', ar: 'عنيزة' },
  { id: 'Khamis Mushait', ar: 'خميس مشيط' },
  { id: 'Abha', ar: 'أبها' },
  { id: 'Hail', ar: 'حائل' },
  { id: 'Al Ahsa', ar: 'الأحساء' },
  { id: 'Hafar Al Batin', ar: 'حفر الباطن' },
  { id: 'Jubail', ar: 'الجبيل' },
  { id: 'Qatif', ar: 'القطيف' },
  { id: 'Al Kharj', ar: 'الخرج' },
  { id: 'Yanbu', ar: 'ينبع' },
  { id: 'Najran', ar: 'نجران' },
  { id: 'Jazan', ar: 'جازان' },
  { id: 'Al Baha', ar: 'الباحة' },
  { id: 'Arar', ar: 'عرعر' },
  { id: 'Sakaka', ar: 'سكاكا' },
  { id: 'Al Qurayyat', ar: 'القريات' },
  { id: 'Al Ula', ar: 'العلا' },
];

/** The most a salon may list — matched to 0023's check constraint. */
export const MAX_CITIES = 20;

/**
 * A stored city in the reader's language. A value that is not on the list —
 * typed freehand before 0023 — is shown as it was written rather than hidden.
 */
export function cityLabel(id: string, isArabic: boolean): string {
  if (!isArabic) return id;
  return CITIES.find((city) => city.id === id)?.ar ?? id;
}

/**
 * Whether a salon serves a city. Compared case-insensitively and trimmed,
 * because the freehand field this replaced accepted " riyadh" as readily as
 * "Riyadh", and those salons should not vanish from the filter.
 */
export function servesCity(cities: readonly string[], city: string | null): boolean {
  if (city === null) return true;
  const wanted = city.trim().toLowerCase();
  return cities.some((value) => value.trim().toLowerCase() === wanted);
}
