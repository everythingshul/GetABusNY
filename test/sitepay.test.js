// Customer payments use Stripe's API with card fields on our own pages: no Stripe Checkout anywhere.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
const d0 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
Object.assign(process.env, { DB_PATH: path.join(d0, 't.db'), DATA_DIR: d0, UPLOAD_DIR: d0, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://localhost:1', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' });
delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.SMS_API_BASE;
const realFetch = globalThis.fetch; const stripeCalls = []; let piState = {};
globalThis.fetch = async (url, o) => {
  const u = String(url); if (!u.includes('api.stripe.com')) return realFetch(url, o);
  const body = new URLSearchParams(o?.body || ''); const rel = u.split('/v1/')[1]; stripeCalls.push({ method: o?.method, rel, body });
  const json = (x) => new Response(JSON.stringify(x), { status: 200 });
  if (rel === 'payment_intents' && o.method === 'POST') return json({ id: 'pi_site1', client_secret: 'pi_site1_secret_z' });
  if (rel.startsWith('payment_intents/')) return json(piState[rel.split('/')[1]] || { error: { message: 'no such' } });
  if (rel === 'customers') return json({ id: 'cus_1' });
  if (rel === 'setup_intents' && o.method === 'POST') return json({ id: 'seti_1', client_secret: 'seti_1_secret_q' });
  if (rel.startsWith('setup_intents/')) return json({ id: 'seti_1', status: 'succeeded', customer: 'cus_1', payment_method: 'pm_1', metadata: { customer_id: String(cidG) } });
  if (rel.startsWith('payment_methods/')) return json({ id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } });
  return json({});
};
const D = await import('../src/db.js'); const S = await import('../src/services.js'); const { pub } = await import('../src/routes/public.js'); const { signLink } = await import('../src/auth.js');
const app = express(); app.use(express.json()); app.use('/api/public', pub);
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); }); const base = `http://localhost:${server.address().port}/api/public`;
const post = async (p, b) => { const r = await realFetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const cidG = D.insert('customers', { name: 'Site Payer', email: 'sp@example.com', created_at: D.now(), updated_at: D.now() }); const cid = cidG;
const iid = D.insert('invoices', { number: 'INV-S1', customer_id: cid, status: 'sent', items: JSON.stringify([{ desc: 'Bus', qty: 1, unit_cents: 100000 }]), deposit_cents: 40000, token: 'tokS1', cc_fee_on: 1, cc_fee_pct: 3, cc_fee_flat_cents: 30, created_at: D.now(), updated_at: D.now() }); S.recalcInvoice(iid);
try {
  // ---- paying: a PaymentIntent is created (no Checkout session), with the card fee, and the page gets what it needs to show the card field
  let r = await post('/invoice/tokS1/pay', { mode: 'deposit' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.client_secret, 'pi_site1_secret_z'); assert.equal(r.body.publishable_key, 'pk_test_x'); assert.equal(r.body.amount_cents, 40000); assert.equal(r.body.fee_cents, 1230); assert.equal(r.body.total_cents, 41230);
  const c1 = stripeCalls.find((c) => c.rel === 'payment_intents'); assert.equal(c1.body.get('amount'), '41230'); assert.equal(c1.body.get('metadata[via]'), 'site'); assert.equal(c1.body.get('metadata[fee_cents]'), '1230');
  assert.ok(!stripeCalls.some((c) => /checkout/.test(c.rel)), 'Stripe Checkout is never used');
  // the invoice page says card payments are available and carries the publishable key
  const view = await (await realFetch(`${base}/invoice/tokS1`)).json(); assert.equal(view.payments_enabled, true); assert.equal(view.publishable_key, 'pk_test_x');

  // ---- completing: the result is read back from Stripe; the same payment twice is recorded once
  piState.pi_site1 = { id: 'pi_site1', status: 'succeeded', amount: 41230, amount_received: 41230, metadata: { invoice_id: String(iid), terminal: '1', via: 'site', fee_cents: '1230', customer_id: String(cid) } };
  r = await post('/invoice/tokS1/pay/complete', { payment_intent: 'pi_site1' }); assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  await post('/invoice/tokS1/pay/complete', { payment_intent: 'pi_site1' });
  const pays = D.all("SELECT * FROM payments WHERE invoice_id=? AND method='card'", iid); assert.equal(pays.length, 1); assert.equal(pays[0].amount_cents, 40000); assert.equal(pays[0].fee_cents, 1230); assert.equal(pays[0].note, 'Paid online');
  piState.pi_other = { id: 'pi_other', status: 'succeeded', amount: 100, metadata: { invoice_id: '999', terminal: '1' } };
  assert.equal((await post('/invoice/tokS1/pay/complete', { payment_intent: 'pi_other' })).status, 400, 'a payment for another invoice is refused');
  assert.equal((await post('/invoice/tokS1/pay/complete', { payment_intent: 'nonsense' })).status, 400);

  // ---- a hold from the office's private link: the amount is signed into the link
  assert.equal((await post('/invoice/tokS1/hold', { amount_cents: 20000, sig: 'bad' })).status, 400, 'an unsigned amount is refused');
  assert.equal((await post('/invoice/tokS1/hold', { amount_cents: 99999999, sig: signLink('hold|tokS1|99999999') })).status, 400, 'more than is due is refused');
  r = await post('/invoice/tokS1/hold', { amount_cents: 20000, sig: signLink('hold|tokS1|20000') }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const hc = stripeCalls.filter((c) => c.rel === 'payment_intents').pop(); assert.equal(hc.body.get('capture_method'), 'manual'); assert.equal(hc.body.get('amount'), '20000');
  piState.pi_site1 = { id: 'pi_site1', status: 'requires_capture', amount: 20000, amount_capturable: 20000, metadata: { invoice_id: String(iid), terminal: '1', via: 'site', mode: 'auth', customer_id: String(cid) } };
  r = await post('/invoice/tokS1/pay/complete', { payment_intent: 'pi_site1' }); assert.equal(r.body.held, true);
  const hold = D.one("SELECT * FROM payments WHERE method='card_auth'"); assert.equal(hold.amount_cents, 20000); assert.equal(hold.status, 'authorized');

  // ---- saving a card on a page of ours (no Checkout), through a signed link
  assert.equal((await realFetch(`${base}/save-card/${cid}/wrongsig`)).status, 404);
  const sig = signLink(`card|${cid}`); const info = await (await realFetch(`${base}/save-card/${cid}/${sig}`)).json(); assert.equal(info.ready, true); assert.equal(info.publishable_key, 'pk_test_x'); assert.ok(info.consent);
  r = await post(`/save-card/${cid}/${sig}/intent`); assert.equal(r.status, 200); assert.equal(r.body.client_secret, 'seti_1_secret_q');
  assert.equal(stripeCalls.filter((c) => c.rel === 'setup_intents' && c.method === 'POST').length, 1); assert.ok(!stripeCalls.some((c) => /checkout/.test(c.rel)));
  assert.equal((await post(`/save-card/${cid}/${sig}/intent`.replace(sig, 'bad'))).status, 404);
  r = await post(`/save-card/${cid}/${sig}/complete`, { setup_intent: 'seti_1' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const cu = D.one('SELECT * FROM customers WHERE id=?', cid); assert.equal(cu.card_last4, '4242'); assert.equal(cu.card_pm, 'pm_1'); assert.ok(cu.card_consent_at, 'consent is recorded');
  assert.equal((await post(`/save-card/${cid}/${sig}/complete`, { setup_intent: 'nope' })).status, 400);
  // ---- staff enter a card any time: a payment that is not on a quote, with the card typed next
  const { quickPayment } = await import('../src/ledger.js');
  const q = await quickPayment({ name: 'Walk In', amount_cents: 25000, description: 'Deposit', mode: 'enter_card' }, 'admin');
  assert.equal(q.enter_card, true); const qi = D.one('SELECT * FROM invoices WHERE id=?', q.invoice_id); assert.equal(qi.total_cents, 25000); assert.equal(qi.status, 'sent'); assert.ok(!q.paid);
  assert.equal(D.all("SELECT * FROM outbox WHERE subject LIKE '%Invoice%'").length, 0, 'nothing is sent to the customer');
  console.log('Site card payment checks passed.');
} finally { server.close(); }
