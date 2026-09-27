import { salonCategory, salonTags } from '../i18n';
import type { Salon } from '../types';

/**
 * Finding a salon by typing its name.
 *
 * The whole catalogue is already in memory — `loadCatalog()` fetches every
 * published salon — so this filters what is there rather than asking the
 * database again. That keeps it instant, keeps it working on the sample data
 * with no backend, and adds no query for a list this size. If the catalogue
 * ever grows past a few hundred salons it wants a server-side search instead,
 * and that is the point to notice it.
 *
 * **The interesting half is Arabic.** A customer typing `ميزون` should find
 * `مِيزُون`, and one typing `ورده` should find `وردة` — Arabic is written with
 * optional vowel marks and with letters that have several forms, so a raw
 * `includes` misses matches that look identical on screen. Normalising both
 * sides is what makes the field feel like it works rather than like it is
 * broken:
 *
 *   * vowel marks and tatweel removed — they are decoration and nobody types
 *     them into a search box;
 *   * every alef form folded to one, because أ إ آ ا are the same letter to
 *     somebody looking for a name;
 *   * ة folded to ه and ى to ي, which is how people actually type;
 *   * Arabic-Indic digits folded to Latin ones, since the app writes Latin
 *     digits everywhere (CLAUDE.md §4) and a phone keyboard may not.
 *
 * Latin gets the same treatment in its own way: accents stripped and case
 * folded, so `noir` finds `Noir` and `cafe` would find `café`.
 */

/** Vowel marks, the superscript alef, and Quranic annotation marks. */
const ARABIC_MARKS = /[ً-ٰٟۖ-ۭ]/g;
/** The kashida, used to stretch a word for typography and never typed. */
const TATWEEL = /ـ/g;
/** Anything that is not a letter or a digit, in any script. */
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

/** Arabic-Indic and extended Arabic-Indic digits, in order 0-9. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function foldDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String(code - base);
}

/**
 * One comparable form for a piece of text, in either script.
 *
 * Used on both the query and the salon, so the two are folded identically —
 * normalising only one side is the bug that makes a search box look random.
 */
export function normalize(text: string): string {
  return (
    text
      // Decompose, so Latin accents become a letter plus a combining mark that
      // the mark-stripping below removes.
      .normalize('NFD')
      .replace(ARABIC_MARKS, '')
      .replace(TATWEEL, '')
      // The remaining combining marks are the Latin accents from NFD.
      .replace(/[̀-ͯ]/g, '')
      .replace(ARABIC_DIGITS, foldDigit)
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .toLowerCase()
      // Punctuation and spacing become single spaces, so "Rose & Oud" is found
      // by "rose oud" and by "rose&oud" alike.
      .replace(NOT_WORD, ' ')
      .trim()
  );
}

/**
 * Everything about a salon worth matching against, in both languages.
 *
 * Both languages always, whichever the app is showing: somebody reading the
 * Arabic app may still type a salon's Latin name, because that is often what
 * is on its shopfront and on its receipts.
 *
 * Service names are deliberately not in here. They are loaded per salon rather
 * than for the catalogue, so including them would mean widening what the home
 * screen holds — worth doing when somebody asks to search by treatment, and
 * not before.
 */
function haystack(salon: Salon): string {
  return normalize(
    [
      salon.name,
      salon.ar,
      salon.area,
      salon.arArea,
      salonTags(salon, 'en'),
      salonTags(salon, 'ar'),
      salonCategory(salon, 'en'),
      salonCategory(salon, 'ar'),
    ].join(' '),
  );
}

/**
 * Whether this salon answers the query.
 *
 * Every whitespace-separated word must appear somewhere, so "rose riyadh"
 * narrows rather than widens — which is what typing a second word is for.
 * Substring rather than whole-word, because "mais" should find "Maison" while
 * somebody is still typing.
 */
export function salonMatches(salon: Salon, query: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = haystack(salon);
  return words.every((word) => hay.includes(word));
}

/**
 * The salons that answer the query, in the order the catalogue gave them.
 *
 * Recomputed on every keystroke, which is free for a catalogue of this size
 * and stays honest: there is no stale index to fall out of step with the rows.
 */
export function searchSalons(salons: Salon[], query: string): Salon[] {
  if (normalize(query) === '') return salons;
  return salons.filter((salon) => salonMatches(salon, query));
}
