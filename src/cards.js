// Saved cards: save a card on file with consent, charge it later, remove it.
import { one, update, now, log } from './db.js';
import { recordPayment, invoiceBalance } from './services.js';
import { getPaymentMethod, getSetupIntent, getPaymentIntent, chargeSaved, detachPaymentMethod, CARD_CONSENT, money } from './integrations.js';

export async function saveCardFor(customer_id, stripe_customer_id, pm_id) {
  const pm = await getPaymentMethod(pm_id);
  const c = pm.card || {};
  update('customers', customer_id, { stripe_customer_id, card_pm: pm_id, card_brand: c.brand || 'card', card_last4: c.last4 || '', card_exp: c.exp_month ? `${String(c.exp_month).padStart(2, '0')}/${c.exp_year}` : '', card_consent_at: now(), card_consent_text: CARD_CONSENT(), updated_at: now() });
  log('stripe', 'card.saved', 'customer', customer_id, `${c.brand} ${c.last4}`);
}
export async function saveCardFromSetup(customer_id, stripe_customer_id, setup_intent_id) {
  const si = await getSetupIntent(setup_intent_id);
  if (si.payment_method) await saveCardFor(customer_id, stripe_customer_id, typeof si.payment_method === 'string' ? si.payment_method : si.payment_method.id);
}
export async function saveCardFromPayment(customer_id, stripe_customer_id, payment_intent_id) {
  const pi = await getPaymentIntent(payment_intent_id);
  if (pi.payment_method) await saveCardFor(customer_id, stripe_customer_id || pi.customer, typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method.id);
}
export const cardOf = (c) => (c?.card_pm ? { brand: c.card_brand, last4: c.card_last4, exp: c.card_exp, since: c.card_consent_at } : null);

/** Charge the card on file toward an invoice. */
export async function chargeInvoice(invoice_id, amount_cents, actor) {
  const i = one('SELECT * FROM invoices WHERE id=?', invoice_id);
  if (!i || i.status === 'void' || i.status === 'draft') throw Object.assign(new Error('Send the invoice first.'), { status: 400 });
  const c = one('SELECT * FROM customers WHERE id=?', i.customer_id);
  if (!c?.card_pm || !c.card_consent_at) throw Object.assign(new Error('This customer has no card on file with permission to charge it.'), { status: 400 });
  const bal = invoiceBalance(i);
  const amt = Math.round(Number(amount_cents)) || bal;
  if (amt < 100 || amt > bal) throw Object.assign(new Error(`Enter an amount between $1.00 and ${money(bal)}.`), { status: 400 });
  const pi = await chargeSaved({ customer: c.stripe_customer_id, pm: c.card_pm, amount_cents: amt, invoice: i });
  if (pi.status !== 'succeeded') throw Object.assign(new Error('The charge did not go through. Send the customer a payment link.'), { status: 402 });
  recordPayment(i.id, { amount_cents: pi.amount_received || amt, method: 'card', stripe_session: pi.id, stripe_pi: pi.id, reference: `${c.card_brand} ${c.card_last4}` , note: 'Charged to card on file' }, actor);
  log(actor, 'card.charged', 'invoice', i.id, money(amt));
  return { ok: true, charged_cents: pi.amount_received || amt };
}
export async function removeCard(customer_id, actor) {
  const c = one('SELECT * FROM customers WHERE id=?', customer_id);
  if (c?.card_pm) { try { await detachPaymentMethod(c.card_pm); } catch { /* already gone at Stripe */ } }
  update('customers', customer_id, { card_pm: null, card_brand: null, card_last4: null, card_exp: null, card_consent_at: null, card_consent_text: null });
  log(actor, 'card.removed', 'customer', customer_id);
}
