// Finding a salon by typing its name, on the customer's Explore tab.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/15-search.mjs
//
// The catalogue is already in memory, so this filters rather than queries —
// which means these checks are the whole evidence, not half of it. There is no
// grant or policy behind a client-side filter for the database assertions to
// prove.
//
// The half worth most is Arabic. A customer typing `ميزون` must find `ميزون
// نوار`, and one typing `ورده` must find `وردة وعود` — Arabic is written with
// optional vowel marks and with letters that have several forms, so a raw
// includes() misses matches that look identical on the screen. Every one of
// those cases is checked here, because every one of them is a search box that
// looks broken to the person using it.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

// No Supabase stub at all: with nothing reachable the app falls back to the
// bundled sample catalogue, which is exactly the surface being searched.
async function explore(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
}

const field = (page) => page.locator('#salon-search');

async function type(page, text) {
  await field(page).fill(text);
  await page.waitForTimeout(350);
}

/** The salon names currently rendered in the list. */
async function listed(page) {
  const body = await page.locator('body').innerText();
  return body;
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await explore(page, arabic);

  check(`${L}: the search field is on Explore`, await field(page).isVisible());

  // Everything is listed before anything is typed.
  let body = await listed(page);
  check(`${L}: every salon is listed to begin with`,
        body.includes(arabic ? 'ميزون نوار' : 'Maison Noir')
        && body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'),
        body.slice(0, 400).replace(/\n/g, ' '));

  // A plain name search narrows to one.
  await type(page, arabic ? 'وردة' : 'Rose');
  body = await listed(page);
  check(`${L}: typing a name finds that salon`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud'),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and drops the ones that do not match`,
        !body.includes(arabic ? 'ميزون نوار' : 'Maison Noir'),
        body.slice(0, 400).replace(/\n/g, ' '));

  // The hero and the category rail step aside, or the rail reads as though it
  // still applies to what is on screen.
  check(`${L}: the headline steps aside while searching`,
        !body.includes(arabic ? 'احجز الجمال' : 'Book beauty,'),
        body.slice(0, 300).replace(/\n/g, ' '));
  check(`${L}: and the results are labelled as results`,
        body.includes(arabic ? 'النتائج' : 'Results'),
        body.slice(0, 300).replace(/\n/g, ' '));

  // Part of a word, because people search while they are still typing.
  await type(page, arabic ? 'ميز' : 'mais');
  body = await listed(page);
  check(`${L}: a partial name matches`,
        body.includes(arabic ? 'ميزون نوار' : 'Maison Noir'),
        body.slice(0, 400).replace(/\n/g, ' '));

  // Nothing found says so, rather than showing an empty screen.
  await type(page, 'zzzzq');
  body = await listed(page);
  check(`${L}: nothing found says so`,
        body.includes(arabic ? 'لا يوجد صالون مطابق' : 'No salon matches that'),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and offers a way back`,
        body.includes(arabic ? 'عرض كل الصالونات' : 'Show all salons'),
        body.slice(0, 400).replace(/\n/g, ' '));

  await page.getByRole('button', { name: arabic ? /عرض كل الصالونات/ : /Show all salons/ }).click();
  await page.waitForTimeout(400);
  body = await listed(page);
  check(`${L}: which restores the whole catalogue`,
        body.includes(arabic ? 'ميزون نوار' : 'Maison Noir')
        && body.includes(arabic ? 'احجز الجمال' : 'Book beauty,'),
        body.slice(0, 400).replace(/\n/g, ' '));

  // Tapping a result opens it, which is the point of finding it.
  await type(page, arabic ? 'وردة' : 'Rose');
  await page.getByRole('button', { name: new RegExp(arabic ? 'وردة وعود' : 'Rose & Oud') }).first().click();
  await page.waitForTimeout(700);
  body = await listed(page);
  check(`${L}: a result opens that salon`,
        body.includes(arabic ? 'وردة وعود' : 'Rose & Oud')
        && !body.includes(arabic ? 'النتائج' : 'Results'),
        body.slice(0, 300).replace(/\n/g, ' '));

  await page.close();
}

// ---------------------------------------------------------------------------
// Arabic, which is where a naive search box quietly fails.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await explore(page, true);

  // ة against ه. "وردة وعود" is the salon; people type "ورده".
  await type(page, 'ورده وعود');
  let body = await listed(page);
  check('AR: taa marbuta and haa are the same letter to a searcher',
        body.includes('وردة وعود'), body.slice(0, 300).replace(/\n/g, ' '));

  // Vowel marks, which nobody types but which may be pasted in.
  await type(page, 'مِيزُون');
  body = await listed(page);
  check('AR: vowel marks are ignored', body.includes('ميزون نوار'),
        body.slice(0, 300).replace(/\n/g, ' '));

  // Alef forms. "أ" and "ا" look different and mean the same here.
  await type(page, 'ميزون نوأر');
  body = await listed(page);
  check('AR: every alef form folds to one', body.includes('ميزون نوار'),
        body.slice(0, 300).replace(/\n/g, ' '));

  // An Arabic reader typing the Latin name on the shopfront.
  await type(page, 'Maison');
  body = await listed(page);
  check('AR: the Latin name still finds it in the Arabic app',
        body.includes('ميزون نوار'), body.slice(0, 300).replace(/\n/g, ' '));

  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await explore(page, false);

  // Two words narrow rather than widen — that is what a second word is for.
  await type(page, 'rose oud');
  let body = await listed(page);
  check('EN: both words must match', body.includes('Rose & Oud') && !body.includes('Maison Noir'),
        body.slice(0, 300).replace(/\n/g, ' '));

  await type(page, 'rose maison');
  body = await listed(page);
  check('EN: two words from different salons match neither',
        body.includes('No salon matches that'), body.slice(0, 300).replace(/\n/g, ' '));

  // Punctuation in the name must not be something you have to reproduce.
  await type(page, 'rose and oud');
  body = await listed(page);
  check('EN: a word that is not in the name does not match it',
        body.includes('No salon matches that'), body.slice(0, 300).replace(/\n/g, ' '));

  // An area, because "a salon near me in Olaya" is a real way to look.
  await type(page, 'olaya');
  body = await listed(page);
  check('EN: searching by district works', body.includes('Maison Noir'),
        body.slice(0, 300).replace(/\n/g, ' '));

  // The category rail must not be on screen while searching. Leaving it there
  // is the version of this that looks right and reads as a fault: a "Barber"
  // chip sitting above results that ignore it.
  await type(page, '');
  const railWhenIdle = await page.getByRole('button', { name: /^Barber$/ }).isVisible();
  await type(page, 'rose');
  const railWhenSearching = await page.getByRole('button', { name: /^Barber$/ }).isVisible()
    .catch(() => false);
  check('EN: the category rail is there normally and gone while searching',
        railWhenIdle && !railWhenSearching,
        `idle=${railWhenIdle} searching=${railWhenSearching}`);

  // Clearing with the × restores everything, which is the other way out.
  await page.getByRole('button', { name: /Clear search/ }).click();
  await page.waitForTimeout(400);
  const cleared = await page.locator('body').innerText();
  check('EN: the clear button restores the whole catalogue',
        cleared.includes('Maison Noir') && cleared.includes('Book beauty,'),
        cleared.slice(0, 300).replace(/\n/g, ' '));

  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
