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
  console.log('RFQ edit checks passed.');
} finally { srv.kill(); }
