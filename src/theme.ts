/** Design tokens taken from the Saloni prototype. */

export const color = {
  gold: '#f5c542',
  goldDeep: '#c99a1e',
  goldInk: '#2a2205',
  goldInkAlt: '#3a2e08',
  goldSoft: '#f5d97a',
  goldLink: '#b0891f',

  ink: '#1c1913',
  inkSoft: '#4a453c',
  muted: '#6a6459',
  mutedSoft: '#8a857a',
  mutedFaint: '#a39e93',
  disabled: '#c9c3b7',

  page: '#fdfcfa',
  shell: '#e8e5df',
  surface: '#fff',
  surfaceWarm: '#f7f4ed',
  surfaceSand: '#f4f1ea',
  cream: '#fdf6e2',

  line: '#efece4',
  lineWarm: '#eee9de',
  lineSand: '#eae5da',
  lineFaint: '#f0ede5',
  lineDashed: '#d8d2c6',
  creamLine: '#f3e6bd',

  teal: '#0f7a6b',
  tealSoft: '#e8fbf6',
  tealLine: '#bff0e6',
  tealBright: '#3fd6c1',
  danger: '#e05555',
  success: '#3a8a3a',
} as const;

export const font = {
  sans: 'Manrope, system-ui, sans-serif',
  serif: "'Cormorant Garamond', Georgia, serif",
  arabicDisplay: "'Aref Ruqaa', serif",
  arabicSans: "'IBM Plex Sans Arabic', Manrope, system-ui, sans-serif",
  mono: 'ui-monospace, Menlo, monospace',
} as const;

/** Repeating-stripe placeholders standing in for photography in the prototype. */
export const tile = {
  sand: 'repeating-linear-gradient(135deg,#efe9dd 0 10px,#e7e0d2 10px 20px)',
  taupe: 'repeating-linear-gradient(135deg,#e9e2d6 0 10px,#e1d9ca 10px 20px)',
  blush: 'repeating-linear-gradient(135deg,#efe7dd 0 10px,#e7ded1 10px 20px)',
  stone: 'repeating-linear-gradient(135deg,#ece7dc 0 10px,#e4ddd0 10px 20px)',
  sandFine: 'repeating-linear-gradient(135deg,#efe9dd 0 7px,#e7e0d2 7px 14px)',
  taupeFine: 'repeating-linear-gradient(135deg,#e9e2d6 0 7px,#e1d9ca 7px 14px)',
  blushFine: 'repeating-linear-gradient(135deg,#efe7dd 0 7px,#e7ded1 7px 14px)',
  sandMid: 'repeating-linear-gradient(135deg,#efe9dd 0 8px,#e7e0d2 8px 16px)',
  taupeMid: 'repeating-linear-gradient(135deg,#e9e2d6 0 8px,#e1d9ca 8px 16px)',
  plain: '#f4f1ea',
} as const;

/** The phone shell dimensions the prototype was designed against. */
export const frame = {
  width: 334,
  height: 724,
  radius: 36,
} as const;

/**
 * How each booking status looks on the vendor calendar.
 *
 * These were baked into the sample appointments in data/vendor.ts, one colour
 * literal per row. Real bookings carry a status rather than a palette, so the
 * mapping lives here — and every status in the schema's enum has an entry, so a
 * status the salon has never seen still renders.
 */
export const bookingStatus = {
  pending: { bg: '#eaf1fd', line: '#4a90d9', dot: '#4a90d9' },
  confirmed: { bg: '#fdf6e2', line: '#f5c542', dot: '#f5c542' },
  in_progress: { bg: '#e8fbf6', line: '#3fd6c1', dot: '#3fd6c1' },
  completed: { bg: '#f1f7f1', line: '#3a8a3a', dot: '#3a8a3a' },
  cancelled: { bg: '#fdecec', line: '#e05555', dot: '#e05555' },
  no_show: { bg: '#f4f1ea', line: '#8a857a', dot: '#8a857a' },
} as const;
