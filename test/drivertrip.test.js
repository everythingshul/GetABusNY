// A private link per trip for the driver, texted with the trip and the vendor's name.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-'));
const port = 5900 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.BREVO_API_KEY; delete env.RESEND_API_KEY; delete env.SMS_API_BASE;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
let cookie = '';
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
const pub = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const q = (sql) => { const d = new DatabaseSync(path.join(dir, 't.db')); const r = d.prepare(sql).all(); d.close(); return r; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const A = '/api/admin';
  const cust = (await call('POST', `${A}/customers`, { name: 'Trip Customer', email: 'c@example.com', phone: '5551230000' })).body.id;
  const vendor = (await call('POST', `${A}/vendors`, { name: 'Hudson Coach Lines', active: 1 })).body.id;
  const d1 = (await call('POST', `${A}/drivers`, { name: 'Moshe Driver', phone: '5552223333', vendor_id: vendor, active: 1 })).body.id;
  const d2 = (await call('POST', `${A}/drivers`, { name: 'Yossi Driver', phone: '5554445555', active: 1 })).body.id;
  const IT = [{ kind: 'pickup', address: '1 Pickup St, Brooklyn' }, { kind: 'stop', address: '5 Middle Rd' }, { kind: 'dropoff', address: '22 Camp Rd, Catskills' }];
  const trip = (await call('POST', `${A}/trips`, { customer_id: cust, purpose: 'Camp', depart_at: '2099-08-01T08:00', itinerary: IT, passengers: 52, vendor_id: vendor, onsite_name: 'Rivka On-Site', onsite_phone: '5557778888', notes: 'Gate code 4411. Questions: boss@camp.example', driver_notes: 'Park near the field, email me at x@y.org' })).body.id;
  assert.equal(q('SELECT COUNT(*) n FROM sms_log')[0].n, 0, 'no driver yet, no text');

  // assigning a driver texts them the trip, the vendor and a link of their own
  assert.equal((await call('PUT', `${A}/trips/${trip}`, { driver_id: d1 })).status, 200);
  await new Promise((r) => setTimeout(r, 400));
  const sms = q("SELECT to_phone, body FROM sms_log WHERE kind='driver_trip'"); assert.equal(sms.length, 1, 'the driver was texted'); assert.equal(sms[0].to_phone, '5552223333');
  assert.match(sms[0].body, /Vendor: Hudson Coach Lines/); assert.match(sms[0].body, /Pickup: 1 Pickup St/); assert.match(sms[0].body, /Final drop-off: 22 Camp Rd/); assert.match(sms[0].body, /3 stops in all/); assert.match(sms[0].body, /Passengers: 52/);
  assert.ok(!/Trip Customer|555-?123-?0000|c@example/.test(sms[0].body), 'the customer is not in the text');
  const link = sms[0].body.match(/\/t\/([\w-]+)/); assert.ok(link, 'the text has a link'); const tok = link[1];

  // the link shows this one trip, with the vendor, and the driver can update it
  let r = await pub('GET', `/api/driver/trip/${tok}`); assert.equal(r.status, 200); assert.equal(r.body.trips.length, 1); assert.equal(r.body.trips[0].vendor, 'Hudson Coach Lines'); assert.equal(r.body.driver.name, 'Moshe Driver');
  assert.deepEqual(r.body.trips[0].onsite, { name: 'Rivka On-Site', phone: '5557778888' }, 'the driver gets the on-site contact');
  { const raw = JSON.stringify(r.body); assert.ok(!/@/.test(raw), 'no email address anywhere in what a driver receives'); assert.ok(!/Trip Customer|5551230000|c@example/.test(raw), 'nothing about the customer'); assert.match(raw, /Gate code 4411/, 'the rest of the notes stay'); assert.equal(r.body.trips[0].contact, undefined); assert.equal(r.body.dispatch.email, undefined); }
  r = await pub('POST', `/api/driver/trip/${tok}/status`, { status: 'acknowledged' }); assert.equal(r.status, 200);
  assert.equal((await call('GET', `${A}/trips/${trip}`)).body.driver_status, 'acknowledged');
  assert.equal((await pub('POST', `/api/driver/trip/${tok}/note`, { note: 'Running a few minutes early' })).status, 200);
  assert.equal((await pub('POST', `/api/driver/trip/${tok}/status`, { status: 'nonsense' })).status, 400);
  assert.equal((await pub('GET', '/api/driver/trip/not-a-real-token')).status, 404);

  // the same link on a nearer trip releases the customer's number for calling
  await call('PUT', `${A}/trips/${trip}`, { depart_at: new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16) });
  r = await pub('GET', `/api/driver/trip/${tok}`); assert.equal(r.body.trips[0].status_open, true, 'inside the window the driver can update status'); assert.ok(!JSON.stringify(r.body).includes('5551230000'));
  await call('PUT', `${A}/trips/${trip}`, { depart_at: '2099-08-01T08:00' });

  // changing the driver kills the old link, gives the new driver theirs, and texts them
  assert.equal((await call('PUT', `${A}/trips/${trip}`, { driver_id: d2 })).status, 200); await new Promise((r2) => setTimeout(r2, 400));
  assert.equal((await pub('GET', `/api/driver/trip/${tok}`)).status, 404, 'the first driver link stops working');
  const sms2 = q("SELECT to_phone, body FROM sms_log WHERE kind='driver_trip' ORDER BY id"); assert.equal(sms2.length, 2); assert.equal(sms2[1].to_phone, '5554445555');
  const tok2 = sms2[1].body.match(/\/t\/([\w-]+)/)[1]; assert.notEqual(tok2, tok); assert.equal((await pub('GET', `/api/driver/trip/${tok2}`)).status, 200);
  assert.ok(!/Vendor:/.test(sms2[1].body) || /Vendor: Hudson/.test(sms2[1].body));

  // saving without changing the driver does not text again; the setting can turn texting off
  await call('PUT', `${A}/trips/${trip}`, { passengers: 50 }); await new Promise((r2) => setTimeout(r2, 300)); assert.equal(q("SELECT COUNT(*) n FROM sms_log WHERE kind='driver_trip'")[0].n, 2);
  await call('PUT', `${A}/settings`, { driver_auto_text: '0' }); await call('PUT', `${A}/trips/${trip}`, { driver_id: d1 }); await new Promise((r2) => setTimeout(r2, 300));
  assert.equal(q("SELECT COUNT(*) n FROM sms_log WHERE kind='driver_trip'")[0].n, 2, 'auto text is off');
  // text on demand, and a test sends nothing to the driver
  r = await call('POST', `${A}/trips/${trip}/text-driver`, { test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.test.sent >= 1);
  assert.equal(q("SELECT COUNT(*) n FROM sms_log WHERE kind='driver_trip'")[0].n, 2, 'a test is not texted to the driver');
  const tt = q("SELECT html FROM outbox WHERE kind='test' ORDER BY id DESC LIMIT 1")[0].html; assert.match(tt, /Hudson Coach Lines/); assert.match(tt, /\/t\/[\w-]+/);
  r = await call('POST', `${A}/trips/${trip}/text-driver`, {}); assert.equal(r.status, 400, 'a real text needs texting set up'); // no SMS provider in tests
  assert.equal(q("SELECT COUNT(*) n FROM sms_log WHERE kind='driver_trip'")[0].n, 3, 'it was attempted and logged');

  // cancelled trips and inactive drivers lose the link
  const tokNow = q('SELECT driver_token FROM trips WHERE id=' + trip)[0].driver_token; assert.equal((await pub('GET', `/api/driver/trip/${tokNow}`)).status, 200);
  await call('PUT', `${A}/trips/${trip}`, { status: 'cancelled' }); assert.equal((await pub('GET', `/api/driver/trip/${tokNow}`)).status, 404);
  console.log('Driver trip link checks passed.');
} finally { srv.kill(); }
