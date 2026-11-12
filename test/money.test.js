// Saved cards, gratuity, insurance tracking and quote revisions (Stripe mocked, no network).
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = path.join(os.tmpdir(), `money-${Date.now()}.db`);
process.env.DATA_DIR = os.tmpdir();
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.BASE_URL = 'http://localhost:1';
let failCharge = false;
const stripeCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), body = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : {};
  stripeCalls.push({ u, body });
  const res = (o, ok = true, status = 200) => ({ ok, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (u.endsWith('/v1/customers')) return res({ id: 'cus_1' });
  if (u.includes('/setup_intents/')) return res({ id: 'seti_1', payment_method: 'pm_1' });
  if (u.includes('/payment_methods/pm_1/detach')) return res({ id: 'pm_1' });
  if (u.includes('/payment_methods/')) return res({ id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } });
  if (u.includes('/payment_intents/pi_save')) return res({ id: 'pi_save', payment_method: 'pm_1', customer: 'cus_1' });
  if (u.endsWith('/v1/payment_intents')) return failCharge ? res({ error: { message: 'Your card requires authentication', code: 'authentication_required' } }, false, 402) : res({ id: 'pi_off', status: 'succeeded', amount_received: Number(body.amount) });
  if (u.endsWith('/v1/checkout/sessions')) return res({ id: 'cs_1', url: 'https://stripe.test/pay' });
  return res({ error: { message: 'unexpected ' + u } }, false, 404);
};
const db = await import('../src/db.js');
const S = await import('../src/services.js');
const cards = await import('../src/cards.js');
const { applyStripeEvent } = await import('../src/stripe-events.js');
const I = await import('../src/integrations.js');
const { one, all, insert, update, now } = db;

// --- gratuity ---
const cid = insert('customers', { name: 'Pat', email: 'pat@x.com', phone: '5551112222', created_at: now(), updated_at: now() });
const iid = insert('invoices', { number: 'INV-T1', customer_id: cid, status: 'sent', title: 'Trip', items: [{ desc: 'Charter', qty: 1, unit_cents: 100000 }], tax_rate: 8, token: 't1', due_date: '2099-01-01', created_at: now(), updated_at: now() });
S.recalcInvoice(iid); assert.equal(one('SELECT total_cents t FROM invoices WHERE id=?', iid).t, 108000);
update('invoices', iid, { gratuity_cents: 15000 }); S.recalcInvoice(iid);
let inv = one('SELECT * FROM invoices WHERE id=?', iid); assert.equal(inv.total_cents, 123000); assert.equal(inv.tax_cents, 8000, 'gratuity is not taxed');

// --- saved card: save from a setup session ---
await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_s', mode: 'setup', customer: 'cus_1', setup_intent: 'seti_1', metadata: { customer_id: String(cid) } } } });
let c = one('SELECT * FROM customers WHERE id=?', cid);
assert.equal(c.card_last4, '4242'); assert.equal(c.card_brand, 'visa'); assert.equal(c.card_exp, '12/2030'); assert.ok(c.card_consent_at && /authorize/.test(c.card_consent_text));
assert.deepEqual(cards.cardOf(c), { brand: 'visa', last4: '4242', exp: '12/2030', since: c.card_consent_at });

// --- charge it later (partial), then a bank that asks for confirmation ---
const r = await cards.chargeInvoice(iid, 50000, 'test'); assert.equal(r.charged_cents, 50000);
inv = one('SELECT * FROM invoices WHERE id=?', iid); assert.equal(inv.amount_paid_cents, 50000); assert.equal(inv.status, 'partial');
assert.ok(stripeCalls.some((x) => x.u.endsWith('/v1/payment_intents') && x.body.off_session === 'true' && x.body.confirm === 'true' && x.body.customer === 'cus_1' && x.body.payment_method === 'pm_1'));
await assert.rejects(cards.chargeInvoice(iid, 999999, 'test'), /between/);
failCharge = true; await assert.rejects(cards.chargeInvoice(iid, 10000, 'test'), /bank wants the customer to confirm/); failCharge = false;
await cards.removeCard(cid, 'test'); c = one('SELECT * FROM customers WHERE id=?', cid); assert.equal(c.card_pm, null);
await assert.rejects(cards.chargeInvoice(iid, 10000, 'test'), /no card on file/);

// --- customer ticks "save my card" while paying ---
await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_p', mode: 'payment', payment_status: 'paid', amount_total: 20000, payment_intent: 'pi_save', customer: 'cus_1', metadata: { invoice_id: String(iid), customer_id: String(cid), save_card: '1' } } } });
c = one('SELECT * FROM customers WHERE id=?', cid); assert.equal(c.card_last4, '4242'); assert.equal(one('SELECT amount_paid_cents a FROM invoices WHERE id=?', iid).a, 70000);
const co = await I.createCheckout({ invoice: inv, amount_cents: 5000, email: 'pat@x.com', saveCard: true, stripeCustomer: 'cus_1' });
const sent = stripeCalls.filter((x) => x.u.endsWith('/v1/checkout/sessions')).pop().body; assert.equal(sent['payment_intent_data[setup_future_usage]'], 'off_session'); assert.equal(sent.customer, 'cus_1');

// --- operator insurance ---
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const v1 = insert('vendors', { name: 'Hudson Coach', insurance_carrier: 'Acme Mutual', insurance_expires: day(10), active: 1, created_at: now(), updated_at: now() });
const v2 = insert('vendors', { name: 'Old Line', insurance_expires: day(-3), active: 1, created_at: now(), updated_at: now() });
const v3 = insert('vendors', { name: 'Fine Bus', insurance_expires: day(200), active: 1, created_at: now(), updated_at: now() });
assert.equal(S.insuranceStatus(day(10)).status, 'expiring'); assert.equal(S.insuranceStatus(day(-1)).status, 'expired'); assert.equal(S.insuranceStatus(day(90)).status, 'ok'); assert.equal(S.insuranceStatus('').status, 'none');
assert.equal(S.insuranceStatus(day(10), day(11)).status, 'expired', 'checks a future trip date');
const al = S.insuranceAlerts(); assert.deepEqual(al.map((x) => x.name), ['Old Line', 'Hudson Coach']);
assert.equal(S.checkInsuranceDaily(), 2); assert.equal(S.checkInsuranceDaily(), 0, 'one check per day');
assert.ok(all("SELECT * FROM followups WHERE kind='insurance'").length >= 1);

// --- quote revisions ---
const qid = insert('quotes', { number: 'Q-T1', customer_id: cid, status: 'sent', title: 'Camp', items: [{ desc: 'Charter', qty: 1, unit_cents: 200000 }], tax_rate: 0, deposit_pct: 50, subtotal_cents: 200000, total_cents: 200000, valid_until: '2099-06-01', trip: { depart_at: '2099-06-10T07:00', passengers: 40, itinerary: [{ kind: 'pickup', address: 'Shul', time: '2099-06-10T07:00' }, { kind: 'dropoff', address: 'Camp' }] }, token: 'qt1', created_at: now(), updated_at: now() });
const before = one('SELECT * FROM quotes WHERE id=?', qid);
update('quotes', qid, { items: [{ desc: 'Charter', qty: 1, unit_cents: 220000 }, { desc: 'Additional stop: Rest area', qty: 1, unit_cents: 15000 }], trip: { depart_at: '2099-06-10T08:00', passengers: 44, itinerary: [{ kind: 'pickup', address: 'Shul', time: '2099-06-10T08:00' }, { kind: 'stop', address: 'Rest area', wait_min: 15 }, { kind: 'dropoff', address: 'Camp' }] }, valid_until: '2099-06-05' });
S.recalcQuote(qid);
const revId = S.recordQuoteRevision(before, one('SELECT * FROM quotes WHERE id=?', qid), { by: 'admin@x.com', reason: 'Added a rest stop' });
assert.ok(revId); const revs = S.quoteRevisions(qid); assert.equal(revs.length, 1); assert.equal(revs[0].revision, 2); assert.equal(one('SELECT revision r FROM quotes WHERE id=?', qid).r, 2);
const labels = revs[0].changes.map((x) => `${x.label}|${x.from}|${x.to}`);
assert.ok(labels.some((l) => l === 'Total|$2,000.00|$2,350.00'), labels.join('\n'));
assert.ok(labels.some((l) => l.startsWith('Line changed: Charter|1 x $2,000.00|1 x $2,200.00')) && labels.some((l) => l.startsWith('Line added: Additional stop: Rest area')));
assert.ok(labels.some((l) => l.startsWith('Stop added||Stop: Rest area')) && labels.some((l) => l.startsWith('Departure|June 10, 2099, 7:00 AM|June 10, 2099, 8:00 AM')) && labels.some((l) => l.startsWith('Valid until|June 1, 2099|June 5, 2099')) && labels.some((l) => l.startsWith('Passengers|40|44')));
assert.equal(revs[0].snapshot.total_cents, 200000, 'keeps the previous version');
assert.equal(S.recordQuoteRevision(one('SELECT * FROM quotes WHERE id=?', qid), one('SELECT * FROM quotes WHERE id=?', qid)), null, 'no change, no revision');
assert.equal(S.fmtWhen('2099-06-01T19:05'), 'June 1, 2099, 7:05 PM'); assert.equal(S.fmtDate('2026-11-12'), 'November 12, 2026'); assert.equal(S.fmtWhen('2099-06-01T00:30'), 'June 1, 2099, 12:30 AM');
console.log('Money checks passed.');
