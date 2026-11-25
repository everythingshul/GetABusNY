// Taking a card yourself: a charge or a hold typed into Stripe's secure field.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';

// ---- in-process: what is sent to Stripe, and how results are recorded
const d0 = fs.mkdtempSync(path.join(os.tmpdir(), 'tm0-'));
Object.assign(process.env, { DB_PATH: path.join(d0, 't.db'), DATA_DIR: d0, UPLOAD_DIR: d0, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://localhost:1', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' });
delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.SMS_API_BASE;
const realFetch = globalThis.fetch; const calls = [];
globalThis.fetch = async (url, o) => { calls.push({ url: String(url), body: new URLSearchParams(o?.body || '') }); return { ok: true, status: 200, json: async () => ({ id: 'pi_x', client_secret: 'pi_x_secret' }), text: async () => '' }; };
const D = await import('../src/db.js'); const I = await import('../src/integrations.js'); const S = await import('../src/services.js'); const E = await import('../src/stripe-events.js');
const cid = D.insert('customers', { name: 'Term Payer', email: 'tp@example.com', created_at: D.now(), updated_at: D.now() });
const iid = D.insert('invoices', { number: 'INV-T1', customer_id: cid, status: 'sent', items: JSON.stringify([{ desc: 'Bus', qty: 1, unit_cents: 100000 }]), token: 'tk', cc_fee_on: 1, cc_fee_pct: 3, cc_fee_flat_cents: 30, created_at: D.now(), updated_at: D.now() });
S.recalcInvoice(iid); const inv = D.one('SELECT * FROM invoices WHERE id=?', iid);

await I.createTerminalIntent({ invoice: inv, amount_cents: 100000, fee_cents: 3030, hold: false });
let b = calls.pop().body; assert.equal(calls.length, 0); assert.equal(b.get('amount'), '103030', 'a charge includes the card fee'); assert.equal(b.get('capture_method'), null); assert.equal(b.get('metadata[fee_cents]'), '3030'); assert.equal(b.get('metadata[terminal]'), '1'); assert.equal(b.get('payment_method_types[0]'), 'card');
await I.createTerminalIntent({ invoice: inv, amount_cents: 100000, fee_cents: 3030, hold: true });
b = calls.pop().body; assert.equal(b.get('amount'), '100000', 'a hold is for the amount only'); assert.equal(b.get('capture_method'), 'manual'); assert.equal(b.get('metadata[mode]'), 'auth'); assert.equal(b.get('metadata[fee_cents]'), null);

// a charge is recorded once, the fee kept apart from the balance, even if both the page and the webhook report it
const pi = { id: 'pi_charge1', status: 'succeeded', amount: 103030, amount_received: 103030, metadata: { invoice_id: String(iid), terminal: '1', fee_cents: '3030', customer_id: String(cid) } };
assert.ok(S.recordTerminalIntent(pi)); assert.equal(S.recordTerminalIntent(pi), null, 'the second report is ignored');
await E.applyStripeEvent({ type: 'payment_intent.succeeded', data: { object: pi } });
const pays = D.all("SELECT * FROM payments WHERE invoice_id=? AND method='card'", iid); assert.equal(pays.length, 1); assert.equal(pays[0].amount_cents, 100000); assert.equal(pays[0].fee_cents, 3030);
assert.equal(D.one('SELECT status FROM invoices WHERE id=?', iid).status, 'paid');
// a hold is recorded as a hold, not a payment
const iid2 = D.insert('invoices', { number: 'INV-T2', customer_id: cid, status: 'sent', items: JSON.stringify([{ desc: 'Bus', qty: 1, unit_cents: 50000 }]), token: 'tk2', created_at: D.now(), updated_at: D.now() }); S.recalcInvoice(iid2);
const hp = { id: 'pi_hold1', status: 'requires_capture', amount: 50000, amount_capturable: 50000, metadata: { invoice_id: String(iid2), terminal: '1', mode: 'auth' } };
assert.ok(S.recordTerminalIntent(hp)); assert.equal(S.recordTerminalIntent(hp), null);
const hrow = D.one("SELECT * FROM payments WHERE stripe_pi='pi_hold1'"); assert.equal(hrow.status, 'authorized'); assert.equal(hrow.method, 'card_auth'); assert.equal(D.one('SELECT amount_paid_cents a FROM invoices WHERE id=?', iid2).a, 0, 'a hold does not pay the invoice');
assert.equal(S.recordTerminalIntent({ ...hp, id: 'pi_x2', status: 'requires_payment_method' }), null, 'a card that was not accepted records nothing');
assert.equal(S.recordTerminalIntent({ id: 'pi_y', status: 'succeeded', amount: 1, metadata: { invoice_id: '99999' } }), null, 'an unknown invoice is ignored');

// ---- over HTTP: checks before anything reaches Stripe
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-'));
const port = 5700 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, BASE_URL: base };
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
let cookie = '';
const call = async (method, p, body) => { const r = await realFetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  const A = '/api/admin';
  assert.equal((await call('GET', `${A}/terminal/config`)).status, 401);
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const cfg = (await call('GET', `${A}/terminal/config`)).body; assert.equal(cfg.publishable_key, 'pk_test_x'); assert.equal(cfg.stripe, true);
  const cust = (await call('POST', `${A}/customers`, { name: 'HTTP Payer', email: 'h@example.com' })).body.id;
  const id = (await call('POST', `${A}/invoices`, { customer_id: cust, title: 'T', items: [{ desc: 'Bus', qty: 1, unit_cents: 50000 }], tax_rate: 0 })).body.id;
  let r = await call('POST', `${A}/invoices/${id}/terminal`, { amount_cents: 50, mode: 'charge' }); assert.equal(r.status, 400); assert.match(r.body.error, /at least \$1/);
  r = await call('POST', `${A}/invoices/${id}/terminal`, { amount_cents: 99999999, mode: 'charge' }); assert.equal(r.status, 400); assert.match(r.body.error, /cannot be more than the balance/);
  await call('PUT', `${A}/invoices/${id}`, { status: 'void' }); r = await call('POST', `${A}/invoices/${id}/terminal`, { amount_cents: 5000, mode: 'charge' }); assert.equal(r.status, 400, 'a void invoice cannot be charged');
  r = await call('POST', `${A}/invoices/${id}/terminal/complete`, { payment_intent: '' }); assert.ok(r.status >= 400, 'no payment to complete');
  r = await call('POST', `${A}/customers/${cust}/card/complete`, { setup_intent: 'nope' }); assert.equal(r.status, 400, 'a card cannot be saved without a real setup');
  assert.equal((await call('POST', `${A}/customers/99999/card/complete`, { setup_intent: 'seti_x' })).status, 404);
  console.log('Card terminal checks passed.');
} finally { srv.kill(); }
