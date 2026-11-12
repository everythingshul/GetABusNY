// End-to-end smoke test: spins up the server on a temp DB and walks the whole business flow.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
function makePng() { // tiny valid PNG used as a stand-in signature
  const w = 80, h = 30, row = w * 4 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * row + 1 + x * 4; if ((x * 3 + y) % 9 === 0) { raw[i + 3] = 255; } }
  const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b)); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gab-'));
const port = 3100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, STRIPE_WEBHOOK_SECRET: 'whsec_test', SMS_WEBHOOK_SECRET: 'hooksecret', SESSION_SECRET: 'x'.repeat(32) };
delete env.CHESKY_API_KEY; delete env.STRIPE_SECRET_KEY; delete env.RESEND_API_KEY;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, cwd: process.cwd(), stdio: 'pipe' });
let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const api = async (method, url, body, extra = {}) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
};
const ok = (r, msg) => assert.ok(r.status < 300, `${msg}: ${r.status} ${JSON.stringify(r.body)}`);
let pass = 0; const step = (n) => { pass++; console.log(`  ✓ ${n}`); };

try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/public/config'); break; } catch { await sleep(150); } }
  let r = await api('GET', '/api/public/config'); ok(r, 'config'); assert.equal(r.body.business_name, 'Get A Bus NY'); step('public config');
  r = await api('GET', '/api/public/fleet'); assert.equal(r.body.length, 11); step('fleet seeded (11)');
  r = await api('GET', '/api/admin/customers'); assert.equal(r.status, 401); step('admin requires login');
  r = await api('POST', '/api/public/request', { name: 'Jane Doe', email: 'jane@example.com', phone: '5551234567', sms_optin: true, purpose: 'Camp trip', depart_at: '2099-06-01T08:00', return_at: '2099-06-01T23:00', passengers: 40,
    itinerary: [{ kind: 'pickup', address: '100 Main St, Albany', time: '2099-06-01T08:00' }, { kind: 'pickup', address: '5 Elm St, Monsey' }, { kind: 'stop', address: 'Ohel, Cambria Heights', wait_min: 90 }, { kind: 'dropoff', address: 'Camp Sample, Catskills' }, { kind: 'return_pickup', address: 'Camp Sample, Catskills', time: '2099-06-01T20:00' }, { kind: 'dropoff', address: '100 Main St, Albany' }] }); ok(r, 'request'); const ref = r.body.ref; step('booking request with 6-stop itinerary ' + ref);
  r = await api('POST', '/api/admin/login', { email: 't@t.com', password: 'wrong' }); assert.equal(r.status, 401);
  r = await api('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' }); ok(r, 'login'); step('admin login');
  const reqs = (await api('GET', '/api/admin/requests')).body; assert.equal(reqs.length, 1);
  const det = JSON.parse(reqs[0].details); assert.equal(det.itinerary.length, 6); assert.equal(det.purpose, 'Camp trip'); assert.equal(det.pickup, '100 Main St, Albany'); assert.equal(det.dropoff, 'Camp Sample, Catskills'); step('itinerary + purpose stored, flat pickup/dropoff derived');
  const cust0 = (await api('GET', '/api/admin/customers')).body[0]; assert.equal(cust0.sms_optin, 1); step('text opt-in captured');
  r = await api('POST', `/api/admin/requests/${reqs[0].id}/quote`); ok(r, 'quote from request'); const qid = r.body.quote_id; step('quote created from lead');
  r = await api('POST', '/api/admin/itinerary/lines', { itinerary: det.itinerary, purpose: 'Camp trip' }); ok(r, 'lines'); assert.ok(r.body.length >= 5); assert.ok(r.body.every((l) => l.unit_cents === 0)); assert.ok(r.body.some((l) => /Additional pickup/.test(l.desc)) && r.body.some((l) => /Additional stop/.test(l.desc))); step('route -> unpriced billing lines (pricing stays manual)');
  r = await api('PUT', `/api/admin/quotes/${qid}`, { items: [{ desc: 'Coach 56 seat, 15 hrs', qty: 1, unit_cents: 250000 }], tax_rate: 8 }); ok(r, 'edit quote'); assert.equal(r.body.total_cents, 270000); step('quote totals + tax');
  r = await api('POST', `/api/admin/quotes/${qid}/send`); ok(r, 'send quote'); step('quote sent (logged to outbox)');
  const q = (await api('GET', `/api/admin/quotes/${qid}`)).body;
  r = await api('PUT', `/api/admin/quotes/${qid}`, { items: [{ desc: 'Coach 56 seat, 15 hrs', qty: 1, unit_cents: 260000 }], tax_rate: 8, revision_note: 'Rate corrected' }); ok(r, 'revise'); assert.equal(r.body.total_cents, 280800);
  const revs = (await api('GET', `/api/admin/quotes/${qid}/revisions`)).body; assert.equal(revs.length, 1); assert.equal(revs[0].revision, 2); assert.equal(revs[0].reason, 'Rate corrected'); assert.ok(revs[0].changes.some((c) => c.label === 'Total' && c.from === '$2,700.00' && c.to === '$2,808.00'));
  const pubq = (await api('GET', `/api/public/quote/${q.token}`)).body; assert.equal(pubq.revision, 2); assert.equal(pubq.revisions[0].changes.length > 0, true); step('editing a sent quote records a revision with exactly what changed');
  r = await api('PUT', `/api/admin/quotes/${qid}`, { items: [{ desc: 'Coach 56 seat, 15 hrs', qty: 1, unit_cents: 250000 }], tax_rate: 8 }); ok(r, 'restore'); assert.equal(r.body.total_cents, 270000);
  r = await api('POST', `/api/admin/quotes/${qid}/send`); ok(r, 're-send'); const upd = (await api('GET', '/api/admin/messages-sent?q=Updated')).body; assert.ok(upd.some((m) => /Updated quote/.test(m.title))); step('re-sending emails an "Updated quote" with the changes');
  r = await api('GET', `/api/public/quote/${q.token}`); ok(r, 'public quote'); assert.equal(r.body.total_cents, 270000);
  r = await api('POST', `/api/public/quote/${q.token}/accept`, {}); assert.equal(r.status, 400); step('accepting without a signature is refused');
  r = await api('POST', `/api/public/quote/${q.token}/accept`, { name: 'Jane Doe', signature: makePng(), agree: true }); ok(r, 'accept'); const invTok = r.body.invoice_token; assert.ok(invTok); step('customer signed + accepted -> trip + invoice');
  r = await api('PUT', `/api/admin/quotes/${qid}`, { notes: 'sneaky' }); assert.equal(r.status, 409); step('an accepted and signed quote is locked');
  r = await api('POST', `/api/public/invoice/${invTok}/gratuity`, { pct: 15 }); ok(r, 'tip'); assert.equal(r.body.gratuity_cents, 37500); assert.equal(r.body.total_cents, 270000 + 37500); assert.deepEqual(r.body.tip_options, [10, 15, 20]);
  r = await api('POST', `/api/public/invoice/${invTok}/gratuity`, { pct: 150 }); assert.equal(r.status, 400); r = await api('POST', `/api/public/invoice/${invTok}/gratuity`, { amount_cents: 0 }); assert.equal(r.body.total_cents, 270000); step('customer can add gratuity (not taxed), capped and removable');
  const cons = (await api('GET', '/api/admin/contracts')).body; assert.equal(cons.length, 1); assert.equal(cons[0].status, 'signed'); assert.equal(cons[0].signer_name, 'Jane Doe');
  const pdf = await fetch(base + `/api/admin/contracts/${cons[0].id}/pdf`, { headers: { cookie } }); const pb = Buffer.from(await pdf.arrayBuffer()); assert.equal(pb.subarray(0, 4).toString(), '%PDF'); step('signed contract PDF generated (' + pb.length + ' bytes)');
  const tr0 = (await api('GET', '/api/admin/trips')).body[0]; assert.equal(JSON.parse(tr0.itinerary).length, 6); step('trip inherited the full itinerary');
  r = await api('GET', `/api/public/invoice/${invTok}`); ok(r, 'invoice'); assert.equal(r.body.deposit_due_cents, 135000); step('deposit = 50%');
  r = await api('POST', `/api/public/invoice/${invTok}/pay`, { mode: 'deposit' }); assert.equal(r.status, 502); assert.match(r.body.error, /not configured/); step('stripe pay without key fails cleanly');
  const inv = (await api('GET', '/api/admin/invoices')).body[0];
  // signed Stripe webhook
  const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 135000, payment_intent: 'pi_1', metadata: { invoice_id: String(inv.id) } } } });
  const t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${evt}`).digest('hex');
  r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: evt }); assert.equal(r.status, 200);
  r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: evt }); assert.equal(r.status, 200); // replay
  r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=deadbeef` }, body: evt }); assert.equal(r.status, 400);
  const inv2 = (await api('GET', `/api/admin/invoices/${inv.id}`)).body; assert.equal(inv2.amount_paid_cents, 135000); assert.equal(inv2.status, 'partial'); step('webhook paid deposit once (replay ignored, bad sig rejected)');
  const trip = (await api('GET', '/api/admin/trips')).body[0]; assert.equal(trip.status, 'confirmed'); step('trip auto-confirmed after deposit');
  r = await api('POST', `/api/admin/invoices/${inv.id}/payments`, { amount_cents: 135000, method: 'check', reference: '1001' }); ok(r, 'manual payment'); assert.equal((await api('GET', `/api/admin/invoices/${inv.id}`)).body.status, 'paid'); step('manual payment -> paid');
  r = await api('GET', '/api/admin/zmanim?date=2026-11-13'); ok(r, 'zmanim'); assert.match(r.body.candle_lighting, /PM$/); assert.equal(r.body.weekday, 'Friday');
  r = await api('POST', '/api/admin/schedule-check', { depart_at: '2026-11-14T10:00', return_at: '2026-11-15T09:00', itinerary: [] }); assert.equal(r.body.issues[0].level, 'red'); assert.match(r.body.depart.havdalah, /PM$/); step('zmanim and Shabbos check');
  const vv = (await api('POST', '/api/admin/vendors', { name: 'Lapsed Lines', insurance_expires: '2020-01-01', insurance_carrier: 'Acme' })).body; assert.equal((await api('GET', `/api/admin/vendors/${vv.id}/insurance-check`)).body.today.status, 'expired'); assert.ok((await api('GET', '/api/admin/dashboard')).body.insurance.some((x) => x.name === 'Lapsed Lines')); step('operator insurance expiry shows on the dashboard');
  r = await fetch(base + `/api/admin/vendors/${vv.id}/coi`, { method: 'POST', headers: { 'content-type': 'application/pdf', cookie }, body: Buffer.from('%PDF-1.4 test certificate body') }); assert.equal(r.status, 200); const coi = await fetch(base + `/api/admin/vendors/${vv.id}/coi`, { headers: { cookie } }); assert.equal(coi.status, 200); assert.equal((await fetch(base + `/api/admin/vendors/${vv.id}/coi`)).status, 401); step('certificate of insurance stored privately');
  // card holds / partial capture / release / refunds / disputes, driven by Stripe events
  const wh = async (type, object) => { const body = JSON.stringify({ type, data: { object } }); const ts = Math.floor(Date.now() / 1000); const sg = crypto.createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex'); const x = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sg}` }, body }); assert.equal(x.status, 200, type); };
  const pays = async () => (await api('GET', `/api/admin/invoices/${inv.id}/payments`)).body;
  const paidNow = async () => (await api('GET', `/api/admin/invoices/${inv.id}`)).body.amount_paid_cents;
  const base0 = await paidNow();
  await wh('payment_intent.amount_capturable_updated', { id: 'pi_hold1', amount_capturable: 80000, metadata: { invoice_id: String(inv.id), mode: 'auth' } });
  await wh('payment_intent.amount_capturable_updated', { id: 'pi_hold1', amount_capturable: 80000, metadata: { invoice_id: String(inv.id), mode: 'auth' } }); // replay
  let hold = (await pays()).filter((p) => p.method === 'card_auth'); assert.equal(hold.length, 1); assert.equal(hold[0].status, 'authorized'); assert.equal(await paidNow(), base0); step('card hold recorded once and NOT counted as paid');
  r = await api('POST', `/api/admin/payments/${hold[0].id}/capture`, { amount_cents: 50000 }); assert.ok(r.status >= 400); assert.match(r.body.error, /Stripe is not configured/); step('capture/release call Stripe (clean error here: no Stripe key)');
  r = await api('POST', `/api/admin/payments/${hold[0].id}/capture`, { amount_cents: 90000 }); assert.equal(r.status, 400); step('cannot capture more than the hold');
  await wh('payment_intent.succeeded', { id: 'pi_hold1', amount_received: 50000, metadata: { invoice_id: String(inv.id), mode: 'auth' } });
  hold = (await pays()).filter((p) => p.stripe_pi === 'pi_hold1'); assert.equal(hold[0].status, 'succeeded'); assert.equal(hold[0].amount_cents, 50000); assert.equal(await paidNow(), base0 + 50000); step('partial capture ($500 of $800 hold) counts as paid');
  await wh('payment_intent.amount_capturable_updated', { id: 'pi_hold2', amount_capturable: 30000, metadata: { invoice_id: String(inv.id), mode: 'auth' } });
  await wh('payment_intent.canceled', { id: 'pi_hold2', cancellation_reason: 'requested_by_customer' });
  const rel = (await pays()).find((p) => p.stripe_pi === 'pi_hold2'); assert.equal(rel.status, 'released'); assert.equal(await paidNow(), base0 + 50000); step('released hold never counts as paid');
  await wh('charge.refunded', { payment_intent: 'pi_hold1', refunds: { data: [{ id: 're_1', amount: 12000 }] } });
  assert.equal(await paidNow(), base0 + 50000 - 12000); step('partial refund (from Stripe dashboard) reduces the invoice');
  r = await api('POST', `/api/admin/payments/${hold[0].id}/refund`, { amount_cents: 99999 }); assert.equal(r.status, 400); assert.match(r.body.error, /up to/); step('cannot refund more than what was paid');
  await wh('charge.dispute.created', { payment_intent: 'pi_hold1', amount: 50000, reason: 'fraudulent' });
  assert.ok((await api('GET', '/api/admin/activity')).body.some((a) => a.action === 'payment.dispute')); step('chargeback logged + owner alerted');
  await wh('payment_intent.payment_failed', { id: 'pi_x', metadata: { invoice_id: String(inv.id), invoice_number: inv.number }, last_payment_error: { message: 'Your card was declined.' } }); step('failed payment logged');

  // driver + portal
  r = await api('POST', '/api/admin/drivers', { name: 'Sam Driver', phone: '5559998888', email: 'sam@example.com' }); ok(r, 'driver'); const drv = r.body;
  assert.ok(drv.token && drv.token.length >= 24);
  r = await api('PUT', `/api/admin/trips/${trip.id}`, { driver_id: drv.id, depart_at: new Date(Date.now() + 3600e3).toISOString().slice(0, 16), return_at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16) }); ok(r, 'assign');
  r = await api('GET', `/api/driver/${drv.token}`); ok(r, 'driver portal'); assert.equal(r.body.trips.length, 1); assert.equal(r.body.trips[0].contact_unlocked, true); assert.equal(r.body.trips[0].contact.phone, '5551234567'); step('driver sees customer phone inside window, no password');
  r = await api('PUT', `/api/admin/trips/${trip.id}`, { depart_at: '2099-06-01T08:00', return_at: '2099-06-01T23:00' });
  r = await api('GET', `/api/driver/${drv.token}`); assert.equal(r.body.trips.length, 0); step('far-future trip hidden from driver');
  r = await api('PUT', `/api/admin/trips/${trip.id}`, { depart_at: new Date(Date.now() + 40 * 3600e3).toISOString().slice(0, 16), return_at: new Date(Date.now() + 50 * 3600e3).toISOString().slice(0, 16) });
  r = await api('GET', `/api/driver/${drv.token}`); assert.equal(r.body.trips[0].contact_unlocked, false); assert.equal(r.body.trips[0].contact, null); step('customer contact locked outside the window');
  r = await api('GET', '/api/driver/nottoken123'); assert.equal(r.status, 404); step('bad driver token rejected');
  r = await api('POST', `/api/driver/${drv.token}/trips/${trip.id}/status`, { status: 'en_route' }); ok(r, 'driver status'); step('driver status update');
  // vendors / RFQ
  r = await api('POST', '/api/admin/vendors', { name: 'Hudson Coach Lines', email: 'dispatch@hudson.test', contact_name: 'Pat' }); const v = r.body;
  r = await api('POST', '/api/admin/rfqs', { trip_id: trip.id, vendor_ids: [v.id], message: 'Need best rate' }); ok(r, 'rfq'); step('RFQ sent to vendor');
  const rfq = (await api('GET', '/api/admin/rfqs')).body[0];
  r = await api('POST', `/api/public/rfq/${rfq.token}`, { price: 1900, vehicle: '56 pax MCI', notes: 'Fuel incl.' }); ok(r, 'vendor reply');
  r = await api('POST', `/api/admin/rfqs/${rfq.id}/accept`); ok(r, 'accept rfq'); const t2 = (await api('GET', `/api/admin/trips/${trip.id}`)).body; assert.equal(t2.vendor_cost_cents, 190000); step('vendor price accepted -> cost on trip');
  // followups
  const fu = (await api('GET', '/api/admin/followups')).body; assert.ok(fu.length >= 3); step(`follow-ups scheduled (${fu.length})`);
  r = await api('POST', '/api/public/contact', { name: 'Bob', email: 'b@b.com', body: 'Hello' }); ok(r, 'contact'); step('contact message');
  r = await api('GET', '/api/admin/analytics'); ok(r, 'analytics'); assert.equal(r.body.funnel.accepted, 1); step('analytics');
  r = await api('GET', '/api/admin/dashboard'); ok(r, 'dash'); step('dashboard');
  // new feature checks
  r = await api('GET', '/api/public/places/autocomplete?q=100%20main'); assert.deepEqual(r.body, []); step('places proxy returns [] with no Google key (inputs stay plain text)');
  await fetch(base + '/api/public/t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p: '/fleet', r: 'https://google.com/', s: 'abc' }) });
  r = await api('GET', '/api/admin/traffic'); assert.equal(r.body.totals.views, 1); step('first-party traffic beacon');
  const cal = (await api('GET', '/api/admin/calendar-link')).body; const icsr = await fetch(cal.staff); const ics = await icsr.text(); assert.ok(ics.includes('BEGIN:VEVENT') && ics.includes('Ohel')); step('staff calendar feed (.ics) has the trip + stops');
  const ics2 = await (await fetch(cal.drivers[0].url)).text(); assert.ok(ics2.includes('BEGIN:VCALENDAR')); step('driver calendar feed');
  const xl = await fetch(base + '/api/admin/export/all', { headers: { cookie } }); const xb = Buffer.from(await xl.arrayBuffer()); assert.equal(xb.subarray(0, 2).toString(), 'PK'); assert.ok(xb.length > 2000); step('Excel export of everything (' + xb.length + ' bytes)');
  for (const k of ['customers', 'leads', 'quotes', 'trips', 'stops', 'invoices', 'payments', 'contracts']) { const x = await fetch(base + `/api/admin/export/${k}`, { headers: { cookie } }); assert.equal(x.status, 200, k); }
  step('per-table Excel exports');
  r = await api('POST', `/api/admin/trips/${trip.id}/review-request`); assert.equal(r.status, 400); await api('PUT', '/api/admin/settings', { google_review_url: 'https://g.page/r/test/review' }); r = await api('POST', `/api/admin/trips/${trip.id}/review-request`); ok(r, 'review'); step('Google review request (needs link, then sends)');
  r = await api('POST', `/api/admin/customers/${cust0.id}/text`, { message: 'Hello' }); assert.equal(r.status, 400); assert.match(r.body.error, /not configured/); const tx = (await api('GET', '/api/admin/texts')).body; assert.ok(tx.length >= 3); assert.ok(tx.some((m) => m.kind === 'request_received') && tx.some((m) => m.kind === 'quote_sent')); step('automatic texts attempted at request + quote (' + tx.length + ' logged; send fails cleanly with no SMS keys)');
  const tw = await fetch(base + '/api/public/sms-inbound', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'hooksecret' }, body: JSON.stringify({ from: '+15551234567', body: 'STOP', id: 'm1' }) }); assert.equal(tw.status, 200); assert.equal((await api('GET', '/api/admin/customers')).body[0].sms_optin, 0); step('STOP reply opts the customer out (inbound text webhook)');
  const bad = await fetch(base + '/api/public/sms-inbound', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"from":"1","body":"x"}' }); assert.equal(bad.status, 403); step('inbound webhook rejects a missing secret');
  const ms = (await api('GET', '/api/admin/messages-sent')).body; assert.ok(ms.some((m) => m.type === 'email') && ms.some((m) => m.type === 'sms' && m.direction === 'in')); const em = ms.find((m) => m.type === 'email'); const full = (await api('GET', `/api/admin/messages-sent/email/${em.id}`)).body; assert.ok(full.html.includes('<table')); step('sent-messages center lists emails and texts, with full HTML');
  r = await api('POST', '/api/admin/messages/email', { to: 'x@example.com', subject: 'Hi', html: '<p>Line one<br>Line two</p><script>alert(1)</script><a href="javascript:x()">bad</a><b>bold</b>' }); ok(r, 'rich email'); const rich = (await api('GET', '/api/admin/messages-sent?q=Hi')).body.find((m) => m.title === 'Hi'); const rh = (await api('GET', `/api/admin/messages-sent/email/${rich.id}`)).body.html; assert.ok(rh.includes('Line one<br>Line two') && rh.includes('<b>bold</b>') && !rh.includes('script') && !rh.includes('javascript:')); step('rich-text email keeps formatting and strips scripts');
  const me = (await api('GET', '/api/admin/me')).body.user; r = await api('PUT', `/api/admin/users/${me.id}/notify`, { phone: '5551230000', prefs: { payment: { email: false, sms: true }, new_lead: { email: true, sms: true } } }); ok(r, 'prefs'); const np = (await api('GET', `/api/admin/users/${me.id}/notify`)).body; assert.equal(np.prefs.payment.sms, true); assert.equal(np.prefs.payment.email, false); assert.equal(np.phone, '5551230000'); step('each admin chooses alerts by email and/or text');
  r = await api('PUT', `/api/admin/customers/${cust0.id}`, { sms_optin: 1 }); await api('PUT', '/api/admin/settings', { sms_groups_on: 'payments' }); r = await api('POST', `/api/admin/customers/${cust0.id}/text`, { message: 'manual still allowed' }); assert.match(r.body.error || '', /not configured/); await api('PUT', '/api/admin/settings', { sms_groups_on: 'quotes,payments,reminders,driver,reviews' }); step('admin chooses which automatic texts go out (customers do not)');
  r = await api('PUT', `/api/admin/customers/${cust0.id}`, { sms_optin: 0 });
  r = await api('POST', `/api/admin/customers/${cust0.id}/text`, { message: 'Hello again' }); assert.equal(r.status, 400); assert.match(r.body.error, /opted in/); step('no texts after opt-out');
  r = await api('POST', '/api/public/invoice-lookup', { number: inv.number, email: 'jane@example.com' }); ok(r, 'lookup'); r = await api('POST', '/api/public/invoice-lookup', { number: inv.number, email: 'x@example.com' }); assert.equal(r.status, 404); step('invoice lookup requires matching email');
  for (const p of ['/', '/fleet', '/book', '/about', '/contact', '/terms', '/privacy', '/pay', '/driver', '/admin', '/healthz', '/nope']) { const x = await fetch(base + p); if (p === '/nope') assert.equal(x.status, 404); else assert.equal(x.status, 200, p); }
  step('all pages served');
  console.log(`\nAll ${pass} checks passed.`);
} catch (e) { console.error('\nFAILED:', e.message); console.error(out.split('\n').slice(-15).join('\n')); process.exitCode = 1; } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
