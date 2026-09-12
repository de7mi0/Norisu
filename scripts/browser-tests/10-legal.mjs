// The privacy policy and terms of service.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/10-legal.mjs
//
// Both app stores refuse a submission without a privacy policy at a public
// URL, and the Saudi PDPL wants one whether they ask or not — so most of what
// these check is reachability by somebody who has never seen the app: a
// reviewer opening a link cold, with no account and nobody to ask.
//
// The rest check that the words say the things that would be *wrong* to leave
// out, in both languages: that no card details are collected, what a salon can
// see about a customer, and what deleting an account does and does not remove.
// Those three are where a policy drafted from a template would quietly differ
// from what migration 0016 and the 0005 functions actually do.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// Signed out on purpose: this is the state a store reviewer arrives in.
async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    return ok(route, []);
  });
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

const browser = await chromium.launch({ executablePath: BROWSER });

// ---------------------------------------------------------------------------
// The URL a reviewer is given. No account, no chooser, no tapping through.
// ---------------------------------------------------------------------------
for (const [suffix, wanted] of [['?legal', 'privacy'], ['?legal=privacy', 'privacy'],
                                ['?legal=terms', 'terms']]) {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(`${BASE}${suffix}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();

  check(`${suffix} opens the page without signing in`,
        body.includes('Privacy & terms'), body.slice(0, 200).replace(/\n/g, ' '));

  // The chooser is the app's front door; a policy link must not stop there.
  check(`${suffix} does not land on the chooser`,
        !body.includes("I'm a customer"), body.slice(0, 160).replace(/\n/g, ' '));

  const onTerms = /Which law applies/.test(body);
  check(`${suffix} opens on the ${wanted} half`,
        wanted === 'terms' ? onTerms : !onTerms && /What Saloni keeps/.test(body),
        body.slice(0, 200).replace(/\n/g, ' '));

  // A reviewer who reloads or forwards the link must get the same page back,
  // which is why — unlike ?claim — this parameter is left in the address bar
  // rather than stripped on arrival. Reloading for real, because asserting the
  // URL alone would pass against code that never read the parameter at all.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const after = await page.locator('body').innerText();
  check(`${suffix} survives a reload`,
        after.includes('Privacy & terms') && /Which law applies/.test(after) === (wanted === 'terms'),
        `${page.url()} — ${after.slice(0, 120).replace(/\n/g, ' ')}`);
  await page.close();
}

// An address typed slightly wrong still reaches the policy rather than the
// chooser: whoever followed it wanted the policy.
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(`${BASE}?legal=nonsense`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();
  check('an unrecognised ?legal value still shows the privacy policy',
        /What Saloni keeps/.test(body), body.slice(0, 160).replace(/\n/g, ' '));
  await page.close();
}

// ---------------------------------------------------------------------------
// Both languages, from the Profile screen — the other way a reviewer finds it.
// ---------------------------------------------------------------------------
for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Profile|حسابي/i }).last().click();
  await page.waitForTimeout(700);

  let body = await page.locator('body').innerText();
  const linkName = arabic ? 'الخصوصية والشروط' : 'Privacy & terms';

  // Signed out, because that is how a reviewer arrives.
  check(`${L}: a signed-out visitor is offered the policy from their profile`,
        body.includes(linkName), body.slice(0, 240).replace(/\n/g, ' '));

  await page.getByRole('button', { name: linkName, exact: true }).click();
  await page.waitForTimeout(600);
  body = await page.locator('body').innerText();

  // Nobody here is a lawyer, and the page has to say so before it says
  // anything else.
  check(`${L}: it is marked as a draft for a human to approve`,
        arabic ? /مسودة — غير معتمدة بعد/.test(body) : /Draft — not approved yet/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));
  check(`${L}: and names the blanks somebody still has to fill in`,
        arabic ? /اسم الشركة/.test(body) && /الدولة التي تُستضاف/.test(body)
               : /name and address of the company/.test(body) && /country the database is hosted in/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // No card details anywhere in the app, which is the single most consequential
  // claim on the page: payment is simulated and paid_at is never set.
  check(`${L}: it says no card details are ever collected`,
        arabic ? /لا بيانات بطاقات، أبداً/.test(body) : /No card details, ever/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // The 0005 functions return nullif(full_name, '') and nothing else about the
  // person — no e-mail, no phone. The page has to say exactly that.
  check(`${L}: it says a salon sees the display name and nothing else`,
        arabic ? /اسمك المعروض، ولا شيء آخر عنك/.test(body)
               : /Your display name, and nothing else about you/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and that a customer's e-mail and number never reach one`,
        arabic ? /لا يصلان الصالون أبداً/.test(body)
               : /never reach a salon/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // Migration 0016: the person goes, the salon's record of the day stays.
  check(`${L}: it says what deleting an account removes`,
        arabic ? /يُحذف نهائياً/.test(body) : /Removed for good/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and what it deliberately leaves behind`,
        arabic ? /يبقى، بدونك/.test(body) && /رقم مرجع الحجز مكان اسمك/.test(body)
               : /Kept, without you/.test(body) && /booking reference where your name was/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and that an owner of a salon is refused`,
        arabic ? /يُرفض/.test(body) : /Refused: while your account owns a salon/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // PDPL is the reason this page exists at all in Saudi Arabia.
  check(`${L}: it names the Saudi data protection law`,
        arabic ? /نظام حماية البيانات الشخصية/.test(body)
               : /Personal Data Protection Law/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // The terms are the other half a store asks for, on the same page.
  await page.getByRole('tab', { name: arabic ? 'الشروط' : 'Terms' }).click();
  await page.waitForTimeout(400);
  body = await page.locator('body').innerText();
  check(`${L}: the terms are reachable from the same page`,
        arabic ? /ما هو صالوني/.test(body) : /What Saloni is/.test(body),
        body.slice(0, 300).replace(/\n/g, ' '));
  check(`${L}: the terms say nothing is paid through the app`,
        arabic ? /لا يُدفع شيء عبر صالوني/.test(body) : /Nothing is paid through Saloni/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));
  check(`${L}: and that Saudi law governs them`,
        arabic ? /المملكة العربية السعودية/.test(body) : /Kingdom of Saudi Arabia/.test(body),
        body.slice(0, 400).replace(/\n/g, ' '));

  // Back goes to the profile it was opened from, not to the home screen.
  await page.getByRole('button', { name: arabic ? 'رجوع' : 'Back' }).click();
  await page.waitForTimeout(500);
  body = await page.locator('body').innerText();
  check(`${L}: back returns to the profile`,
        body.includes(arabic ? 'تسجيل الدخول' : 'Sign in') && body.includes(linkName),
        body.slice(0, 200).replace(/\n/g, ' '));

  await page.close();
}

// ---------------------------------------------------------------------------
// A reviewer given the English URL must be able to reach the Arabic text, and
// the Latin names inside an Arabic sentence must not reorder around their
// punctuation — the bidi fault CLAUDE.md §4 warns about.
// ---------------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await page.goto(`${BASE}?legal=privacy`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /^ع$/ }).click();
  await page.waitForTimeout(500);
  const body = await page.locator('body').innerText();
  check('the page can be switched to Arabic without leaving it',
        /الخصوصية والشروط/.test(body) && /ما الذي يحتفظ به صالوني/.test(body),
        body.slice(0, 240).replace(/\n/g, ' '));

  check('the phone frame is right-to-left in Arabic',
        (await page.locator('[dir="rtl"]').count()) > 0);

  // Supabase, GitHub Pages and Google Fonts sit inside Arabic sentences.
  const isolated = await page.locator('.ltr-run', { hasText: 'GitHub Pages' }).count();
  check('Latin names inside the Arabic text are isolated as left-to-right runs',
        isolated > 0, `${isolated} .ltr-run`);

  // The marker is a rendering instruction, never something a reader should see.
  check('and the markers themselves are not rendered',
        !body.includes('[[') && !body.includes(']]'),
        body.slice(0, 200).replace(/\n/g, ' '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
