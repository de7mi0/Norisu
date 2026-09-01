// A salon's photographs: the upload button that never had a handler, and the
// one property that matters most about it.
//
//   BASE=http://localhost:4173/ node scripts/browser-tests/07-photos.mjs
//
// The headline check builds a REAL JPEG carrying a fake EXIF GPS tag, hands it
// to the app through the actual file picker, and inspects the bytes that go up
// the wire. A phone photograph carries the coordinates of where it was taken,
// so this is the difference between publishing a salon's pictures and
// publishing its address.
import { chromium } from 'playwright';

const BROWSER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4173/';
const REF = 'nicdmspejrvruszlwhvm';
const USER = '33333333-3333-3333-3333-333333333333';
const SALON = 'aaaaaaaa-0000-0000-0000-000000000001';
// A second, published salon that has never uploaded anything. Half of what is
// being checked here is that it still looks deliberate rather than broken.
const BARE_SALON = 'aaaaaaaa-0000-0000-0000-000000000002';

const session = {
  access_token: 'stub', refresh_token: 'stub', token_type: 'bearer',
  expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
          phone: '', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const db = { media: [], uploads: [], removed: [], patches: [] };

const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function install(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const req = route.request(); const url = req.url(); const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return ok(route, session.user);
    if (url.includes('/auth/v1/token')) return ok(route, session);

    // The upload itself. The body is the prepared image; that is what we read.
    if (url.includes('/storage/v1/object/')) {
      if (method === 'POST' || method === 'PUT') {
        const path = decodeURIComponent(url.split('/storage/v1/object/')[1] || '')
          .replace(/^salon-photos\//, '');
        db.uploads.push({ path, bytes: req.postDataBuffer() });
        return ok(route, { Key: `salon-photos/${path}` });
      }
      if (method === 'DELETE') { db.removed.push(url); return ok(route, {}); }
      return ok(route, {});
    }

    if (url.includes('/rest/v1/salon_media')) {
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const row = { id: `m${db.media.length + 1}`, storage_path: body.storage_path,
                      alt_text: '', is_cover: Boolean(body.is_cover), sort_order: 0 };
        db.media.push(row);
        return ok(route, row);
      }
      if (method === 'PATCH') {
        db.patches.push(JSON.parse(req.postData() || '{}'));
        return ok(route, []);
      }
      if (method === 'DELETE') { db.media = []; return ok(route, []); }
      return ok(route, db.media);
    }

    if (url.includes('rpc/salon_day')) return ok(route, []);
    if (url.includes('rpc/salon_stats')) return ok(route, [{ bookings_today: 0,
      bookings_yesterday: 0, booked_halalas: 0, occupancy_percent: 0, is_open: true,
      rating: null, review_count: 0 }]);
    if (url.includes('rpc/salon_reviews')) return ok(route, []);
    if (url.includes('/rest/v1/profiles')) return ok(route, { id: USER, role: 'vendor',
      full_name: 'Owner', phone: null, locale: 'en' });
    if (url.includes('/rest/v1/salons')) return ok(route, [{ id: SALON, slug: 'maison-noir',
      name_en: 'Maison Noir', name_ar: 'ميزون نوار', tags_en: 'Hair', tags_ar: 'شعر',
      category_en: 'Salon', category_ar: 'صالون', area_en: 'Al Olaya', area_ar: 'العليا',
      phone: null, city: 'Riyadh', cr_number: '1010', is_published: true, is_verified: true,
      owner_id: USER, slot_step_minutes: 30 }]);
    if (url.includes('/rest/v1/services')) return ok(route, []);
    if (url.includes('/rest/v1/staff')) return ok(route, []);
    if (url.includes('/rest/v1/salon_ratings')) return ok(route, []);
    if (url.includes('/rest/v1/working_hours')) return ok(route, [{ staff_id: null,
      day_of_week: 0, opens_at: '10:00:00', closes_at: '22:00:00' }]);
    if (url.includes('/rest/v1/time_off')) return ok(route, []);
    return ok(route, []);
  });
  await page.addInitScript(([r, v]) =>
    window.localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify(v)), [REF, session]);
}

const results = [];
const check = (n, v, d = '') => { results.push(v); console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${v || !d ? '' : ` — ${d}`}`); };

/**
 * A genuine JPEG, 2400x1200, with an EXIF APP1 segment spliced in after SOI
 * carrying a recognisable fake GPS string. Chromium decodes it happily, which
 * is the point: it is a real photograph as far as the app is concerned.
 */
async function exifJpeg(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    // Noise, so it does not compress to almost nothing and the size check means
    // something.
    const image = ctx.createImageData(2400, 1200);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.random() * 255;
      image.data[i + 1] = Math.random() * 255;
      image.data[i + 2] = Math.random() * 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    const plain = new Uint8Array(await new Promise((resolve) =>
      canvas.toBlob((b) => b.arrayBuffer().then(resolve), 'image/jpeg', 0.95)));

    // The EXIF header, then a payload with a marker we can search the output for.
    const marker = new TextEncoder().encode('Exif  GPSLatitude=24.7136;GPSLongitude=46.6753;');
    const app1 = new Uint8Array(4 + marker.length);
    app1[0] = 0xff; app1[1] = 0xe1;
    app1[2] = ((marker.length + 2) >> 8) & 0xff;
    app1[3] = (marker.length + 2) & 0xff;
    app1.set(marker, 4);

    // SOI, then our segment, then the rest.
    const out = new Uint8Array(2 + app1.length + (plain.length - 2));
    out.set(plain.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(plain.subarray(2), 2 + app1.length);
    return Array.from(out);
  });
}

const browser = await chromium.launch({ executablePath: BROWSER });

async function toGallery(page, arabic) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I own a salon|أملك صالوناً/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Back$|^رجوع$/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /More|المزيد/i }).last().click();
  await page.waitForTimeout(600);
  await page.getByText(/Photo gallery|معرض الصور/).first().click();
  await page.waitForTimeout(800);
}

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  db.media = []; db.uploads = []; db.removed = []; db.patches = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toGallery(page, arabic);

  let body = await page.locator('body').innerText();
  check(`${L}: the gallery says location data is removed`,
        body.includes(arabic ? 'تُزال بيانات الموقع' : 'Location data is removed'),
        body.slice(0, 200).replace(/\n/g, ' '));

  const bytes = await exifJpeg(page);
  check(`${L}: the test photograph really does carry EXIF`,
        String.fromCharCode(...bytes.slice(0, 400)).includes('GPSLatitude'));

  // Through the real picker, as a real file.
  await page.setInputFiles('input[type="file"]', {
    name: 'from-my-phone.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes),
  });
  await page.waitForTimeout(2500);

  const up = db.uploads[0];
  check(`${L}: the upload button works at all`, Boolean(up), JSON.stringify(db.uploads.length));

  const text = up ? up.bytes.toString('latin1') : '';
  check(`${L}: the GPS coordinates are gone`, !text.includes('GPSLatitude'));
  check(`${L}: and so is the EXIF marker itself`, !text.includes('Exif'));
  // supabase-js posts the file as multipart/form-data, so the body is an
  // envelope with the image inside rather than the image itself. Look for the
  // JPEG start-of-image marker within it.
  check(`${L}: what is uploaded is still a JPEG`,
        up ? up.bytes.includes(Buffer.from([0xff, 0xd8, 0xff])) : false,
        up ? up.bytes.subarray(0, 60).toString('latin1').replace(/[^\x20-\x7e]/g, '.') : '');
  check(`${L}: and it is smaller than what came off the phone`,
        up ? up.bytes.length < bytes.length : false,
        up ? `${bytes.length} -> ${up.bytes.length}` : '');
  check(`${L}: it lands in this salon's own folder`,
        up ? up.path.startsWith(`${SALON}/`) : false, up?.path);
  check(`${L}: named randomly, not after the file they picked`,
        up ? !up.path.includes('from-my-phone') : false, up?.path);
  check(`${L}: the first photograph becomes the cover`,
        db.media[0]?.is_cover === true, JSON.stringify(db.media[0]));

  body = await page.locator('body').innerText();
  check(`${L}: and it appears in the gallery, marked as the cover`,
        body.includes(arabic ? 'الغلاف' : 'COVER'),
        body.slice(0, 200).replace(/\n/g, ' '));
  await page.close();
}

// The things that must be refused, and said out loud rather than swallowed.
{
  db.media = []; db.uploads = [];
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await install(page);
  await toGallery(page, false);

  await page.setInputFiles('input[type="file"]', {
    name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not a photo'),
  });
  await page.waitForTimeout(1200);
  let body = await page.locator('body').innerText();
  check('a file that is not a photograph is refused, with a reason',
        /not a photograph/i.test(body), body.slice(0, 200).replace(/\n/g, ' '));
  check('and nothing was uploaded', db.uploads.length === 0);

  await page.setInputFiles('input[type="file"]', {
    name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(21 * 1024 * 1024, 1),
  });
  await page.waitForTimeout(1500);
  body = await page.locator('body').innerText();
  check('an enormous file is refused before it is decoded',
        /enormous/i.test(body), body.slice(0, 200).replace(/\n/g, ' '));
  check('and still nothing was uploaded', db.uploads.length === 0);
  await page.close();
}

// ---------------------------------------------------------------------------
// The customer's side: photographs a salon uploaded actually being shown, and a
// salon with none still looking like a design rather than a failure.
// ---------------------------------------------------------------------------

/** A real 1x1 PNG, so <img> loads rather than falling back to the tile. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const COVER = `${SALON}/cover/a1.jpg`;
const GALLERY = [`${SALON}/gallery/b2.jpg`, `${SALON}/gallery/c3.jpg`];

const salonRow = (id, en, ar) => ({
  id, slug: en.toLowerCase().replace(/ /g, '-'), name_en: en, name_ar: ar,
  tags_en: 'Hair', tags_ar: 'شعر', category_en: 'Salon', category_ar: 'صالون',
  area_en: 'Al Olaya', area_ar: 'العليا', phone: null, city: 'Riyadh',
  cr_number: '1010', is_published: true, is_verified: true, slot_step_minutes: 30,
});

async function installCustomer(page) {
  page.on('pageerror', (e) => console.log(`      [page error] ${e.message.slice(0, 160)}`));
  await page.route(`**/${REF}.supabase.co/**`, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*' } });

    // The bucket is public and these are ordinary image requests, so they have
    // to answer with image bytes: a photograph that fails to load falls back to
    // the tile, which would make this whole section pass for the wrong reason.
    if (url.includes('/storage/v1/object/public/')) return route.fulfill({ status: 200,
      contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PIXEL });

    if (url.includes('/rest/v1/salon_media')) return ok(route, [
      { id: 'm1', salon_id: SALON, storage_path: COVER, alt_text: '', is_cover: true, sort_order: 0 },
      { id: 'm2', salon_id: SALON, storage_path: GALLERY[0], alt_text: 'Styling chairs', is_cover: false, sort_order: 1 },
      { id: 'm3', salon_id: SALON, storage_path: GALLERY[1], alt_text: '', is_cover: false, sort_order: 2 },
    ]);
    if (url.includes('/rest/v1/salons')) return ok(route, [
      salonRow(SALON, 'Maison Noir', 'ميزون نوار'),
      salonRow(BARE_SALON, 'Studio Rima', 'استوديو ريما'),
    ]);
    if (url.includes('/rest/v1/services')) return ok(route, [{ id: 's1', salon_id: SALON,
      name_en: 'Cut & finish', name_ar: 'قص وتصفيف', duration_minutes: 45,
      price_halalas: 15000, discount_percent: 0, is_active: true, is_archived: false,
      sort_order: 0, category_en: 'Hair', category_ar: 'شعر' }]);
    return ok(route, []);
  });
}

const photoImages = (page) => page.locator('img[src*="/salon-photos/"]');
const dots = (page) => page.locator('span[style*="height: 3px"]');

for (const arabic of [false, true]) {
  const L = arabic ? 'AR' : 'EN';
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await installCustomer(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (arabic) { await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /I'm a customer|أنا عميل/i }).first().click();
  await page.waitForTimeout(1200);

  let body = await page.locator('body').innerText();
  const srcs = await photoImages(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));

  check(`${L}: home leads with the salon's own photograph`,
        srcs.some((src) => src.includes(COVER)), JSON.stringify(srcs));
  check(`${L}: the "SALON INTERIOR" placeholder is gone where there is one`,
        !body.includes('SALON INTERIOR'), body.slice(0, 160).replace(/\n/g, ' '));
  check(`${L}: the cover, not one of the others, is what the card shows`,
        srcs.every((src) => src.includes(COVER)), JSON.stringify(srcs));
  check(`${L}: a salon with no photographs keeps its tile and adds no image`,
        srcs.length === 2, `${srcs.length} images for 2 salons, one of which has none`);

  // The salon that has photographs.
  await page.getByRole('button', { name: arabic ? /ميزون نوار/ : /Maison Noir/ }).first().click();
  await page.waitForTimeout(900);
  body = await page.locator('body').innerText();
  const gallery = await photoImages(page).evaluateAll((nodes) =>
    nodes.map((n) => ({ src: n.getAttribute('src'), alt: n.getAttribute('alt') })));

  check(`${L}: the salon header shows every photograph, not just the cover`,
        gallery.length === 3, JSON.stringify(gallery.map((g) => g.src)));
  check(`${L}: cover first, in the order the owner arranged them`,
        gallery[0]?.src.includes(COVER) && gallery[1]?.src.includes(GALLERY[0]),
        JSON.stringify(gallery.map((g) => g.src)));
  check(`${L}: the placeholder wording is gone from the header`,
        !body.includes('SALON GALLERY'), body.slice(0, 160).replace(/\n/g, ' '));
  check(`${L}: the dots count the photographs there are, not three`,
        (await dots(page).count()) === 3, String(await dots(page).count()));
  check(`${L}: the salon is named on the photograph it leads with`,
        gallery[0]?.alt === (arabic ? 'ميزون نوار' : 'Maison Noir'), JSON.stringify(gallery[0]));
  check(`${L}: the owner's own words win where they wrote any`,
        gallery[1]?.alt === 'Styling chairs', JSON.stringify(gallery[1]));
  check(`${L}: and the rest are decoration, not the name five times`,
        gallery[2]?.alt === '', JSON.stringify(gallery[2]));

  // Swiping to the second photograph. scrollIntoView rather than a scrollLeft
  // of its own, because in Arabic the strip scrolls the other way and a raw
  // number would be testing the test rather than the screen.
  await page.evaluate(() => {
    const image = document.querySelector('img[src*="/salon-photos/"]');
    // Nothing to swipe if the photographs never arrived — the checks above have
    // already said so, and throwing here would take the rest of them with it.
    if (!image) return;
    const strip = image.closest('span').parentElement;
    strip.children[1].scrollIntoView({ inline: 'start', block: 'nearest' });
  });
  await page.waitForTimeout(600);
  const lit = await dots(page).evaluateAll((nodes) =>
    nodes.findIndex((n) => /245, 197, 66/.test(getComputedStyle(n).backgroundColor)));
  check(`${L}: swiping to the next photograph moves the dot with it`,
        lit === 1, `dot ${lit} is lit`);

  // The salon that has none.
  await page.getByRole('button', { name: /^(Back|رجوع)$/ }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: arabic ? /استوديو ريما/ : /Studio Rima/ }).first().click();
  await page.waitForTimeout(900);
  body = await page.locator('body').innerText();

  check(`${L}: a salon with no photographs still shows the designed placeholder`,
        body.includes('SALON GALLERY'), body.slice(0, 160).replace(/\n/g, ' '));
  check(`${L}: and no image of somebody else's salon leaks onto its page`,
        (await photoImages(page).count()) === 0, String(await photoImages(page).count()));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
