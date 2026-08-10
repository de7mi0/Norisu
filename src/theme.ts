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
