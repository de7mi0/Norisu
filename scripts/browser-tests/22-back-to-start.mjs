// The way out of each side leads to the opening screen.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/22-back-to-start.mjs
//
// Reported by the owner: leaving the customer side took you straight into the
// salon owner's portal, and leaving that took you into the customer app — never
// back to the screen where you choose. Both buttons now say "Back to start" and
// go there, in both languages.
import { chromium } from 'playwright';

// The stable path; the versioned one under it changes when the image updates.
const BROWSER = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const browser = await chromium.launch({ executablePath: BROWSER });

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.route(`**/${REF}.supabase.co/**`, (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    : ok(route, []));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  const customer = page.getByRole('button', { name: /I'm a customer|أنا عميل/i });
  const back = page.getByRole('button', { name: arabic ? /^العودة للبداية$/ : /^Back to start$/ });

  // Customer → Profile → Back to start.
  await customer.first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: arabic ? /^حسابي$/ : /^Profile$/ }).first().click();
  await page.waitForTimeout(400);
  check(`${L}: the customer side offers "Back to start"`, (await back.count()) === 1);
  await back.click();
  await page.waitForTimeout(500);
  check(`${L}: and it opens the start screen, not the salon portal`,
        (await customer.count()) > 0 && (await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).count()) > 0);

  // Salon side → More → Back to start.
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(400);
  await back.click();
  await page.waitForTimeout(500);
  check(`${L}: the salon side's "Back to start" opens the start screen, not the customer app`,
        (await customer.count()) > 0);
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
