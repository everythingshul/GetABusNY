// Trash (nothing is destroyed, nothing counts), editing after confirming, driver info, and the trips/conflicts route.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
const port = 5800 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.BREVO_API_KEY; delete env.RESEND_API_KEY; delete env.SMS_API_BASE;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
let cookie = '';
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
const q = (sql) => { const d = new DatabaseSync(path.join(dir, 't.db')); const r = d.prepare(sql).all(); d.close(); return r; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const A = '/api/admin';
  // the route that used to answer "Not found" when assigning a driver
  let r = await call('GET', `${A}/trips/conflicts?id=0&from=2099-01-01T08:00&to=&driver_id=&vehicle_id=`); assert.equal(r.status, 200, 'trips/conflicts is reachable'); assert.ok(Array.isArray(r.body));
  assert.equal((await call('GET', `${A}/trips/notanumber`)).status, 404);

  const cust = (await call('POST', `${A}/customers`, { name: 'Trash Customer', email: 'tc@example.com', phone: '5551110000' })).body.id;
  const vendor = (await call('POST', `${A}/vendors`, { name: 'Secret Coach Lines', email: 'v@example.com', phone: '5559998888', active: 1 })).body.id;
  const driver = (await call('POST', `${A}/drivers`, { name: 'Moshe Driver', phone: '5552223333', vendor_id: vendor, active: 1 })).body.id;
  const IT = [{ kind: 'pickup', address: '1 Pickup St' }, { kind: 'dropoff', address: '2 Drop Ave' }];
  const trip = (await call('POST', `${A}/trips`, { customer_id: cust, purpose: 'Camp', depart_at: '2099-08-01T08:00', itinerary: IT, driver_id: driver, vendor_id: vendor, onsite_name: 'Contact Person', onsite_phone: '5554445555' })).body.id;
  const inv = (await call('POST', `${A}/invoices`, { customer_id: cust, trip_id: trip, title: 'Camp invoice', items: [{ desc: 'Bus', qty: 1, unit_cents: 100000 }], tax_rate: 0 })).body.id;
  await call('POST', `${A}/invoices/${inv}/send`, { skip_email: true });
  assert.equal((await call('POST', `${A}/invoices/${inv}/payments`, { amount_cents: 40000, method: 'cash', skip_email: true, skip_sms: true })).status, 200);
  const money = async () => (await call('GET', `${A}/ledger?from=all&to=all`)).body.totals.money_in;
  assert.equal(await money(), 40000, 'the payment is in the ledger');

  // ---- editing a hand-entered payment fixes the invoice and the ledger
  const pay = (await call('GET', `${A}/invoices/${inv}/payments`)).body[0];
  assert.equal((await call('PUT', `${A}/payments/${pay.id}`, { amount_cents: 50000, method: 'check', reference: 'CK1001', date: '2026-11-20' })).status, 200);
  assert.equal((await call('GET', `${A}/invoices/${inv}`)).body.amount_paid_cents, 50000); assert.equal(await money(), 50000, 'the ledger follows the edit');
  assert.equal((await call('PUT', `${A}/payments/${pay.id}`, { amount_cents: -5 })).status, 400);

  // ---- an invoice with a payment goes to the trash: nothing counts, nothing is lost
  assert.equal((await call('POST', `${A}/trash/invoices/${inv}`, {})).status, 200);
  assert.equal((await call('GET', `${A}/invoices/${inv}`)).status, 404, 'gone from the live list');
  assert.ok(!(await call('GET', `${A}/invoices`)).body.some((x) => x.id === inv));
  assert.equal(await money(), 0, 'its payment no longer counts in the ledger');
  assert.equal(q('SELECT COUNT(*) n FROM payments')[0].n, 0, 'its payments are not in the live tables');
  let trash = (await call('GET', `${A}/trash`)).body; assert.equal(trash.length, 1); assert.equal(trash[0].label, 'Invoice'); assert.equal(trash[0].restored_at, null);
  assert.ok(q('SELECT data FROM trash')[0].data.includes('Camp invoice'), 'the whole record is kept');
  // restore puts everything back
  assert.equal((await call('POST', `${A}/trash-items/${trash[0].id}/restore`, {})).status, 200);
  assert.equal((await call('GET', `${A}/invoices/${inv}`)).status, 200); assert.equal((await call('GET', `${A}/invoices/${inv}`)).body.amount_paid_cents, 50000); assert.equal(await money(), 50000, 'counts again once restored');
  assert.equal((await call('POST', `${A}/trash-items/${trash[0].id}/restore`, {})).status, 400, 'restoring twice is refused');
  assert.equal((await call('DELETE', `${A}/trash-items/${trash[0].id}`)).status, 404, 'there is no way to delete from the trash');
  assert.equal((await call('GET', `${A}/trash`)).body.length, 1, 'the trash keeps its history');

  // ---- numbers are never reused, even after trashing the newest
  const q1 = (await call('POST', `${A}/quotes`, { customer_id: cust, title: 'Q1', items: [{ desc: 'Bus', qty: 1, unit_cents: 1000 }], tax_rate: 0, trip: { itinerary: IT } })).body; const seq1 = q1.seq;
  await call('DELETE', `${A}/quotes/${q1.id}`); // the old delete route now trashes
  const q2 = (await call('POST', `${A}/quotes`, { customer_id: cust, title: 'Q2', items: [{ desc: 'Bus', qty: 1, unit_cents: 1000 }], tax_rate: 0, trip: { itinerary: IT } })).body;
  assert.ok(q2.seq === undefined || q2.seq > seq1 || seq1 === undefined, 'a trashed number is not reused');
  assert.ok(q('SELECT COUNT(*) n FROM trash WHERE entity=\'quotes\'')[0].n === 1);

  // ---- an accepted quote can still be edited
  await call('POST', `${A}/quotes/${q2.id}/send`, { skip_email: true, skip_sms: true });
  assert.equal((await call('POST', `${A}/quotes/${q2.id}/accept`, { reason: 'phone' })).status, 200);
  r = await call('PUT', `${A}/quotes/${q2.id}`, { title: 'Changed after accepting', items: [{ desc: 'Bus', qty: 1, unit_cents: 2000 }] }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.title, 'Changed after accepting');

  // ---- guards keep the books together
  assert.equal((await call('POST', `${A}/trash/customers/${cust}`, {})).status, 400, 'a customer with trips and invoices cannot be trashed first');
  assert.equal((await call('POST', `${A}/trash/drivers/${driver}`, {})).status, 400, 'a driver on a trip cannot be trashed');
  assert.equal((await call('POST', `${A}/trash/nonsense/1`, {})).status, 400);
  assert.equal((await call('POST', `${A}/trash/trips/99999`, {})).status, 404);

  // ---- a trip can be trashed whatever its status, and restored
  await call('PUT', `${A}/trips/${trip}`, { status: 'completed' });
  assert.equal((await call('POST', `${A}/trash/trips/${trip}`, {})).status, 200); assert.equal((await call('GET', `${A}/trips/${trip}`)).status, 404);
  const tt = (await call('GET', `${A}/trash`)).body.find((x) => x.entity === 'trips'); assert.equal((await call('POST', `${A}/trash-items/${tt.id}/restore`, {})).status, 200);
  assert.equal((await call('GET', `${A}/trips/${trip}`)).body.status, 'completed');

  // ---- driver info: driver and vehicle only, never the vendor
  const before = q("SELECT COUNT(*) n FROM outbox WHERE kind='test'")[0].n;
  r = await call('POST', `${A}/trips/${trip}/driver-info`, { to: ['customer', 'contact'], email: true, sms: true, test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = q("SELECT subject, html FROM outbox WHERE kind='test' ORDER BY id").slice(before);
  assert.ok(rows.length >= 2, 'an email and a text-as-email were produced');
  const all = rows.map((x) => x.html).join('\n'); assert.match(all, /Moshe Driver/); assert.match(all, /555-?222-?3333|5552223333/);
  assert.ok(!/Secret Coach/i.test(all) && !/5559998888/.test(all) && !/v@example\.com/.test(all), 'the vendor is never mentioned');
  assert.equal(q("SELECT COUNT(*) n FROM outbox WHERE kind<>'test' AND subject LIKE '%driver%'")[0].n, 0, 'a test sends nothing to the customer');
  r = await call('POST', `${A}/trips/${trip}/driver-info`, { to: ['contact'], test_send: true }); assert.equal(r.status, 200);
  await call('PUT', `${A}/trips/${trip}`, { onsite_phone: '' }); r = await call('POST', `${A}/trips/${trip}/driver-info`, { to: ['contact'] }); assert.equal(r.status, 400, 'no on-site phone, no send');
  await call('PUT', `${A}/trips/${trip}`, { driver_id: null }); r = await call('POST', `${A}/trips/${trip}/driver-info`, { to: ['customer'] }); assert.equal(r.status, 400, 'no driver, no send');
  console.log('Trash and editing checks passed.');
} finally { srv.kill(); }
