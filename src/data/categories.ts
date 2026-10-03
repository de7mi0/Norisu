/**
 * The kinds of salon an owner picks from when registering.
 *
 * Picked rather than typed so that the customer side can rely on the words:
 * the category chips on Explore match by substring (`matchesCategory`), so a
 * salon registered as "Men's barber" is found under Barber and one typed as
 * "barbr" never was. Each English label therefore contains the chip word it
 * belongs under.
 *
 * "Other" stays, with both languages typed by the owner, because a list can
 * never be complete and a salon that does not fit should still be able to say
 * what it is.
 */
export interface SalonCategory {
  en: string;
  ar: string;
}

export const SALON_CATEGORIES: readonly SalonCategory[] = [
  { en: 'Ladies salon', ar: 'صالون نسائي' },
  { en: "Men's barber", ar: 'حلاق رجالي' },
  { en: 'Hair', ar: 'شعر' },
  { en: 'Nails', ar: 'أظافر' },
  { en: 'Skin & facial', ar: 'العناية بالبشرة' },
  { en: 'Makeup', ar: 'مكياج' },
  { en: 'Bridal', ar: 'عرائس' },
  { en: 'Spa & massage', ar: 'سبا ومساج' },
  { en: 'Lashes & brows', ar: 'رموش وحواجب' },
  { en: 'Hair removal', ar: 'إزالة الشعر' },
  { en: 'Henna', ar: 'حناء' },
];

/** The listed category a stored pair is, or null when the owner typed their own. */
export function findCategory(en: string, ar: string): SalonCategory | null {
  return SALON_CATEGORIES.find((category) => category.en === en && category.ar === ar) ?? null;
}
