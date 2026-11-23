// Editing trip details before sending a vendor request; optional save back to the customer's request with the original kept.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfe-'));
const port = 5200 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.SMS_API_BASE; delete env.BREVO_API_KEY; delete env.RESEND_API_KEY;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
let cookie = '';
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const A = '/api/admin';
  await call('POST', `${A}/vendors`, { name: 'Op One', email: 'op@example.com', active: 1 });
  const vid = (await call('GET', `${A}/vendors`)).body[0].id;
  const mk = async (n) => { await call('POST', '/api/public/request', { name: 'Cust ' + n, email: `c${n}@example.com`, phone: '55500012' + n, purpose: 'Camp trip', passengers: 30, depart_at: '2099-07-07T08:00', itinerary: [{ kind: 'pickup', address: '1 A St' }, { kind: 'dropoff', address: '2 B St' }] }); return (await call('GET', `${A}/requests`)).body.find((x) => x.name === 'Cust ' + n); };
  const edits = { purpose: 'Camp trip', passengers: 44, depart_at: '2099-07-07T09:30', return_at: '', itinerary: [{ kind: 'pickup', address: '1 A St', time: '2099-07-07T09:30' }, { kind: 'stop', address: '9 Extra Rd' }, { kind: 'dropoff', address: '2 B St' }] };
  // snapshot only: the customer's request is untouched
  let q = await mk('11');
  let r = await call('POST', `${A}/rfqs`, { request_id: q.id, vendor_ids: [vid], edits });
  assert.equal(r.status, 200);
  const rf = (await call('GET', `${A}/rfqs`)).body[0]; const snap = typeof rf.snapshot === 'string' ? JSON.parse(rf.snapshot) : rf.snapshot;
  assert.equal(snap.passengers, 44); assert.ok(snap.itinerary.some((x) => x.address === '9 Extra Rd'), 'the vendor sees the edited stops');
  let after = (await call('GET', `${A}/requests`)).body.find((x) => x.id === q.id); const d0 = typeof after.details === 'string' ? JSON.parse(after.details) : after.details;
  assert.equal(d0.passengers, 30); assert.ok(!after.original_details, 'not saved unless asked');
  // saved: revised copy kept on the request, original preserved, internal note added
  q = await mk('22');
  assert.equal((await call('POST', `${A}/rfqs`, { request_id: q.id, vendor_ids: [vid], edits, save_to_request: true })).status, 200);
  after = (await call('GET', `${A}/requests`)).body.find((x) => x.id === q.id);
  const d1 = typeof after.details === 'string' ? JSON.parse(after.details) : after.details, o1 = typeof after.original_details === 'string' ? JSON.parse(after.original_details) : after.original_details;
  assert.equal(d1.passengers, 44); assert.ok(d1.itinerary.some((x) => x.address === '9 Extra Rd')); assert.equal(d1.stops, '9 Extra Rd');
  assert.equal(o1.passengers, 30); assert.equal(o1.itinerary.length, 2, 'the original request is preserved');
  assert.match(after.notes, /Revised by staff/);
  // a second revision keeps the very first original
  await call('POST', `${A}/rfqs`, { request_id: q.id, vendor_ids: [vid], edits: { ...edits, passengers: 50 }, save_to_request: true });
  after = (await call('GET', `${A}/requests`)).body.find((x) => x.id === q.id); const o2 = typeof after.original_details === 'string' ? JSON.parse(after.original_details) : after.original_details;
  assert.equal(o2.passengers, 30);
  // no edits behaves as before
  const q3 = await mk('33'); assert.equal((await call('POST', `${A}/rfqs`, { request_id: q3.id, vendor_ids: [vid] })).status, 200);
  // award with a changed price, retract, send an updated itinerary
  await call('POST', `${A}/vendors`, { name: 'Op Two', email: 'op2@example.com', active: 1 });
  const vid2 = (await call('GET', `${A}/vendors`)).body.find((v) => v.name === 'Op Two').id;
  const tr = await call('POST', `${A}/trips`, { customer_id: q.customer_id, purpose: 'Award test', passengers: 20, depart_at: '2099-08-01T08:00', itinerary: [{ kind: 'pickup', address: '5 Z St' }, { kind: 'dropoff', address: '6 Y St' }] });
  assert.equal(tr.status, 200, JSON.stringify(tr.body)); const tid = tr.body.id;
  await call('POST', `${A}/rfqs`, { trip_id: tid, vendor_ids: [vid, vid2] });
  const list = (await call('GET', `${A}/rfqs`)).body.filter((x) => x.trip_id === tid); assert.equal(list.length, 2);
  for (const x of list) assert.equal((await call('POST', `${A}/rfqs/${x.id}/reply`, { price: 1000, vehicle: 'MCI', notes: 'ok' })).status, 200);
  const [a1, a2] = list;
  assert.equal((await call('POST', `${A}/rfqs/${a1.id}/accept`, { price_cents: 123400, vehicle: 'Van', notes: 'fuel included' })).status, 200);
  let rows = (await call('GET', `${A}/rfqs`)).body; let x1 = rows.find((x) => x.id === a1.id), x2 = rows.find((x) => x.id === a2.id);
  assert.equal(x1.status, 'accepted'); assert.equal(x1.price_cents, 123400, 'price changed on award'); assert.equal(x1.offered_vehicle, 'Van'); assert.equal(x2.status, 'closed');
  let trip = (await call('GET', `${A}/trips/${tid}/detail`)).body; assert.equal(trip.vendor_id, a1.vendor_id); assert.equal(trip.vendor_cost_cents, 123400);
  assert.equal((await call('POST', `${A}/rfqs/${a1.id}/accept`, { price_cents: 0 })).status, 400, 'needs a price');
  assert.equal((await call('POST', `${A}/rfqs/${a1.id}/accept`, { price_cents: 150000, notify: false })).status, 200); trip = (await call('GET', `${A}/trips/${tid}/detail`)).body; assert.equal(trip.vendor_cost_cents, 150000, 'award can be changed later');
  assert.equal((await call('POST', `${A}/rfqs/${a1.id}/send-update`, { message: 'Pickup moved' })).status, 200 , 'update goes to the awarded vendor');
  assert.equal((await call('POST', `${A}/rfqs/${a2.id}/retract`, {})).status, 400, 'only awarded ones can be retracted');
  assert.equal((await call('POST', `${A}/rfqs/${a1.id}/retract`, { notify: true })).status, 200);
  rows = (await call('GET', `${A}/rfqs`)).body; x1 = rows.find((x) => x.id === a1.id); x2 = rows.find((x) => x.id === a2.id);
  assert.equal(x1.status, 'responded'); assert.equal(x2.status, 'responded', 'the other vendor request reopens');
  trip = (await call('GET', `${A}/trips/${tid}/detail`)).body; assert.ok(!trip.vendor_id); assert.equal(trip.vendor_cost_cents, 0);
  console.log('RFQ edit checks passed.');
} finally { srv.kill(); }
