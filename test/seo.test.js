// SEO checks: head tags, JSON-LD, sitemap, robots, legacy Blogger redirects, noindex on private pages.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
const port = 4100 + Math.floor(Math.random() * 400), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o });
try {
  await sleep(4500);
  for (const [from, to] of [['/p/request-quote.html', '/book'], ['/p/to-get-bus-ny.html', '/contact'], ['/2022/03/blog-post.html', '/fleet'], ['/p/make-a-payment', '/pay'], ['/search?q=bus', '/'], ['/feeds/posts/default', '/'], ['/2019/05/anything.html', '/fleet'], ['/fleet.html', '/fleet']]) {
    const r = await get(from); assert.equal(r.status, 301, from); assert.equal(r.headers.get('location'), to, from);
  }
  const home = await (await get('/')).text();
  assert.match(home, /<title>[^<]*Get A Bus NY/); assert.equal((home.match(/<title>/g) || []).length, 1);
  assert.match(home, new RegExp(`<link rel="canonical" href="${base}/">`)); assert.match(home, /og:title/); assert.match(home, /twitter:card/);
  const ld = [...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const org = ld.find((x) => x['@type'] === 'TravelAgency'); assert.ok(org && org.openingHoursSpecification.length === 2); assert.equal(org.foundingDate, '2016');
  assert.match(home, /href="\/trips\/camp-trips"/); for (const a of ['boro-park', 'williamsburg', 'flatbush', 'monsey', 'lakewood', 'linden', 'jackson', 'toms-river', 'monroe', 'catskills', 'jersey-city', 'manhattan', 'new-square', 'cleveland', 'chicago', 'indiana', 'michigan']) { assert.match(home, new RegExp(`href="/areas/${a}"`), a); const ar = await get('/areas/' + a); assert.equal(ar.status, 200, a); const at = await ar.text(); assert.match(at, /FAQPage/); assert.ok(!at.includes('<!--TRIP-->')); } assert.match(home, /href="\/bus\/1"/);
  const fleet = await (await get('/fleet')).text(); assert.match(fleet, /ItemList/); assert.match(fleet, /56 Seater Coach Bus/);
  const bus = await get('/bus/1'); const bt = await bus.text(); assert.equal(bus.status, 200); assert.match(bt, /"@type":"Product"/); assert.match(bt, /og:image/); assert.ok(!bt.includes('<!--OG-->'));
  assert.equal((await get('/bus/9999')).status, 404);
  const trip = await get('/trips/shabbatons'); const tt = await trip.text(); assert.equal(trip.status, 200); assert.match(tt, /<h1>Buses for Shabbatons<\/h1>/); assert.match(tt, /FAQPage/); assert.match(tt, /BreadcrumbList/); assert.ok(!tt.includes('<!--TRIP-->'));
  assert.equal((await get('/trips/nope')).status, 404);
  const sm = await (await get('/sitemap.xml')).text();
  for (const p of ['/', '/fleet', '/book', '/contact', '/trips/camp-trips', '/areas/boro-park', '/areas/michigan', '/bus/1']) assert.ok(sm.includes(`<loc>${base}${p}</loc>`), p);
  assert.ok(!sm.includes('/admin') && !sm.includes('/pay'));
  const rb = await (await get('/robots.txt')).text(); assert.match(rb, /Disallow: \/admin/); assert.match(rb, /Sitemap: .*\/sitemap\.xml/);
  assert.equal((await get('/quote/abc')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await get('/site.webmanifest')).status, 200); assert.equal((await get('/favicon.ico')).status, 200); assert.equal((await get('/img/apple-touch-icon.png')).status, 200);
  const dash = /[- - ]/; for (const p of ['/', '/fleet', '/trips/chasunos', '/bus/2']) { const t = await (await get(p)).text(); const m = t.match(/.{30}[\u2013\u2014].{30}/); assert.ok(!m, 'dash on ' + p + ': ' + (m && m[0])); };
  const gz = await fetch(base + '/', { headers: { 'accept-encoding': 'gzip' } }); assert.equal(gz.headers.get('content-encoding'), 'gzip');
  console.log('SEO checks passed.');
} finally { srv.kill(); }
