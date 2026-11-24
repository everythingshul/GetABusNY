// "Send me a test": goes to the business email only, changes nothing, marks nothing sent.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
const port = 5500 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
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
  const biz = (await call('GET', `${A}/settings`)).body.email; assert.ok(biz, 'there is a business email');
  const cust = (await call('POST', `${A}/customers`, { name: 'Test Customer', email: 'customer@example.com', phone: '5551234567' })).body.id;
  const before = q('SELECT COUNT(*) n FROM outbox')[0].n;

  // quote: the test email goes to the business address, the quote stays a draft
  const qid = (await call('POST', `${A}/quotes`, { customer_id: cust, title: 'Test quote', items: [{ desc: 'Bus', qty: 1, unit_cents: 50000 }], tax_rate: 0, deposit_pct: 50, trip: { itinerary: [{ kind: 'pickup', address: '1 A St' }, { kind: 'dropoff', address: '2 B St' }] } })).body.id;
  let r = await call('POST', `${A}/quotes/${qid}/send`, { test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.test.to, biz); assert.ok(r.body.test.sent >= 1, 'an email was produced');
  assert.equal((await call('GET', `${A}/quotes/${qid}`)).body.status, 'draft', 'a test does not mark the quote sent');
  assert.equal(q("SELECT COUNT(*) n FROM outbox WHERE kind<>'test'")[0].n, before, 'nothing is logged as sent to the customer'); assert.equal(q("SELECT COUNT(*) n FROM outbox WHERE to_addr='customer@example.com'")[0].n, 0, 'nothing went to the customer address'); assert.ok(q("SELECT COUNT(*) n FROM outbox WHERE kind='test' AND subject LIKE '[TEST]%'")[0].n >= 1, 'the test is logged under Sent messages');
  assert.equal(q('SELECT COUNT(*) n FROM followups')[0].n, 0, 'no follow-ups are created');

  // invoice
  const iid = (await call('POST', `${A}/invoices`, { customer_id: cust, title: 'Test invoice', items: [{ desc: 'Bus', qty: 1, unit_cents: 50000 }], tax_rate: 0 })).body.id;
  r = await call('POST', `${A}/invoices/${iid}/send`, { test_send: true }); assert.equal(r.status, 200); assert.ok(r.body.test.sent >= 1);
  assert.equal((await call('GET', `${A}/invoices/${iid}`)).body.status, 'draft');
  // a recorded payment test does not record the payment
  r = await call('POST', `${A}/invoices/${iid}/payments`, { amount_cents: 10000, method: 'cash', test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(q('SELECT COUNT(*) n FROM payments')[0].n, 0, 'no payment is recorded by a test');

  // compose email and text, even with texting not set up
  r = await call('POST', `${A}/messages/email`, { to: 'customer@example.com', subject: 'Hello', html: '<p>Hi there</p>', test_send: true }); assert.equal(r.status, 200); assert.equal(r.body.test.sent, 1);
  r = await call('POST', `${A}/messages/text`, { customer_id: cust, message: 'Test text', test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.test.sent, 1, 'a text test arrives as an email');
  r = await call('POST', `${A}/customers/${cust}/text`, { message: 'Another', test_send: true }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.test.sent, 1);
  assert.equal(q('SELECT COUNT(*) n FROM sms_log')[0].n, 0, 'no text is logged'); assert.equal(q("SELECT COUNT(*) n FROM outbox WHERE kind<>'test'")[0].n, before);

  // without the flag, a real send still happens and is logged
  r = await call('POST', `${A}/messages/email`, { to: 'customer@example.com', subject: 'Real', html: '<p>Real</p>' }); assert.equal(r.status, 200);
  assert.equal(q("SELECT COUNT(*) n FROM outbox WHERE kind<>'test'")[0].n, before + 1, 'real sends are unchanged');
  assert.equal(q("SELECT to_addr FROM outbox ORDER BY id DESC LIMIT 1")[0].to_addr, 'customer@example.com');
  // the flag only counts when it is exactly true
  r = await call('POST', `${A}/messages/email`, { to: 'customer@example.com', subject: 'Real2', html: '<p>x</p>', test_send: 'yes' }); assert.equal(r.body.test, undefined);
  console.log('Test send checks passed.');
} finally { srv.kill(); }
