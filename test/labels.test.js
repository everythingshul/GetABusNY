// Labels: colored, nested like Gmail, attachable to many kinds of items.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lbl-'));
const port = 5100 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.SMS_API_BASE; delete env.BREVO_API_KEY; delete env.RESEND_API_KEY;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
try {
  await sleep(4500);
  assert.equal((await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' })).status, 200);
  const A = '/api/admin';
  let r = await call('GET', `${A}/labels`); assert.equal(r.status, 200); assert.deepEqual(r.body.labels, []); assert.ok(r.body.palette.length >= 20); assert.ok(r.body.types.includes('quote') && r.body.types.includes('ledger') && r.body.types.includes('customer'));

  // create, with a color, then nest by typing a path
  r = await call('POST', `${A}/labels`, { name: 'Camps', color: '#16a765' }); assert.equal(r.status, 200); const camps = r.body.id;
  r = await call('POST', `${A}/labels`, { name: 'Camps/Summer/Opening day' }); assert.equal(r.status, 200);
  const list = r.body.labels; assert.deepEqual(list.map((l) => l.path), ['Camps', 'Camps/Summer', 'Camps/Summer/Opening day'], 'the path is created, and Camps is reused');
  assert.deepEqual(list.map((l) => l.depth), [0, 1, 2]); assert.equal(list[0].color, '#16a765'); assert.match(list[2].color, /^#[0-9a-f]{6}$/);
  const opening = list[2].id, summer = list[1].id;
  assert.equal((await call('POST', `${A}/labels`, { name: '' })).status, 400); assert.equal((await call('POST', `${A}/labels`, { name: 'x', parent_id: 9999 })).status, 400);
  r = await call('POST', `${A}/labels`, { name: 'Camps' }); assert.equal(r.body.labels.filter((l) => l.name === 'Camps').length, 1, 'same name under the same parent is reused');
  r = await call('POST', `${A}/labels`, { name: 'Urgent', color: '#fb4c2f' }); const urgent = r.body.id;
  r = await call('POST', `${A}/labels`, { name: 'Bad', color: 'red' }); assert.equal(r.status, 200); assert.match(r.body.labels.find((l) => l.name === 'Bad').color, /^#[0-9a-f]{6}$/, 'a bad color falls back to a palette color');

  // edit: rename, recolor, move
  r = await call('PUT', `${A}/labels/${summer}`, { name: 'Summer 2027', color: '#4986e7' }); assert.equal(r.status, 200); assert.ok(r.body.labels.some((l) => l.path === 'Camps/Summer 2027/Opening day'));
  assert.equal((await call('PUT', `${A}/labels/${camps}`, { parent_id: opening })).status, 400, 'cannot nest a label under its own child');
  assert.equal((await call('PUT', `${A}/labels/${camps}`, { parent_id: camps })).status, 400);
  assert.equal((await call('PUT', `${A}/labels/${urgent}`, { color: 'nope' })).status, 400);
  r = await call('PUT', `${A}/labels/${urgent}`, { parent_id: camps }); assert.ok(r.body.labels.some((l) => l.path === 'Camps/Urgent'));
  r = await call('PUT', `${A}/labels/${urgent}`, { parent_id: null }); assert.ok(r.body.labels.some((l) => l.path === 'Urgent'));
  r = await call('POST', `${A}/labels`, { name: 'Camps/urgent' }); assert.equal((await call('PUT', `${A}/labels/${r.body.id}`, { parent_id: null })).status, 400, 'a sibling cannot have the same name (any case)');

  // attach to different kinds of things
  const lead = (await call('POST', '/api/public/request', { name: 'Label Person', email: 'l@example.com', phone: '5550001234', purpose: 'Camp trip', passengers: 20, depart_at: '2099-07-07T08:00', itinerary: [{ kind: 'pickup', address: '1 A St' }, { kind: 'dropoff', address: '2 B St' }] })).body;
  const rq = (await call('GET', `${A}/requests`)).body[0]; const cust = rq.customer_id;
  r = await call('PUT', `${A}/label-items`, { type: 'request', id: rq.id, label_ids: [urgent, opening] }); assert.equal(r.status, 200); assert.equal(r.body.label_ids.length, 2);
  r = await call('PUT', `${A}/label-items`, { type: 'customer', id: cust, label_ids: [camps, camps, 99999] }); assert.deepEqual(r.body.label_ids, [camps], 'duplicates and unknown labels are dropped');
  const led = (await call('POST', `${A}/ledger`, { date: '2026-03-05', direction: 'out', amount_cents: 1000, vendor: 'Sunoco' })).body;
  assert.equal((await call('PUT', `${A}/label-items`, { type: 'ledger', id: led.id, label_ids: [urgent] })).status, 200);
  assert.equal((await call('PUT', `${A}/label-items`, { type: 'banana', id: 1, label_ids: [urgent] })).status, 400); assert.equal((await call('PUT', `${A}/label-items`, { type: 'quote', id: 9999, label_ids: [urgent] })).status, 404);
  r = await call('GET', `${A}/labels`); assert.deepEqual(r.body.links.request[rq.id].sort(), [urgent, opening].sort()); assert.deepEqual(r.body.links.customer[cust], [camps]); assert.deepEqual(r.body.links.ledger[led.id], [urgent]);
  assert.equal(r.body.labels.find((l) => l.id === urgent).count, 2, 'counts items per label');
  // replacing clears the old ones
  await call('PUT', `${A}/label-items`, { type: 'request', id: rq.id, label_ids: [] }); r = await call('GET', `${A}/labels`); assert.equal(r.body.links.request?.[rq.id], undefined);

  // deleting a label moves its children up and removes it from items
  r = await call('DELETE', `${A}/labels/${summer}`); assert.equal(r.status, 200); assert.ok(r.body.labels.some((l) => l.path === 'Camps/Opening day'), 'the child moves up one level');
  r = await call('DELETE', `${A}/labels/${urgent}`); assert.equal(r.body.links.ledger?.[led.id], undefined);
  cookie = ''; assert.equal((await call('GET', `${A}/labels`)).status, 401); assert.equal((await call('POST', `${A}/labels`, { name: 'x' })).status, 401);
  console.log('Label checks passed.');
} finally { srv.kill(); }
