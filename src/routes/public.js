import express from 'express';
import { all, one, run, update, insert, now, getSetting, getJSON, parse, log } from '../db.js';
import { limit } from '../auth.js';
import { createRequest, acceptQuote, recordPayment, invoiceBalance, recalcInvoice, runFollowups, recordAuthorization, markCaptured, markReleased, handleInboundText } from '../services.js';
import { createCheckout, stripeCustomerFor, verifyStripe, env, status as integ, notifyOwner, money } from '../integrations.js';
import fs from 'node:fs';
import { applyStripeEvent } from '../stripe-events.js';
import { placesAutocomplete, placeDetails } from '../integrations.js';
import { contractView, signContract, createContract, contractPdfPath, customerTripIcs, trackView } from '../extras.js';

export const pub = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const fail = (res, code, msg) => res.status(code).json({ error: msg });

pub.get('/config', (req, res) => {
  res.json({
    business_name: getSetting('business_name'), phone: getSetting('phone'), email: getSetting('email'), address: getSetting('address'),
    service_area: getSetting('service_area'), hours: getJSON('hours', []), socials: getJSON('socials', {}),
    chesky: getSetting('chesky_public') === '1', chesky_name: getSetting('chesky_name'), payments: integ().stripe, maps: integ().maps, purposes: getSetting('trip_purposes').split(',').map((x) => x.trim()).filter(Boolean), sms: integ().sms && getSetting('sms_enabled') === '1',
  });
});

pub.get('/vehicle/:id', (req, res) => {
  const v = one('SELECT id,name,category,capacity,description,features,image FROM vehicles WHERE id=? AND active=1', req.params.id);
  if (!v) return fail(res, 404, 'Vehicle not found');
  res.json({ ...v, features: (v.features || '').split(',').map((s) => s.trim()).filter(Boolean) });
});
pub.get('/fleet', (req, res) => {
  res.json(all('SELECT id,name,category,capacity,description,features,image FROM vehicles WHERE active=1 ORDER BY sort,capacity DESC').map((v) => ({ ...v, features: (v.features || '').split(',').map((s) => s.trim()).filter(Boolean) })));
});

pub.post('/request', limit('req', 8, 3600000), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true, ref: 'REQ-0000' }); // honeypot
  try { res.json({ ok: true, ...createRequest(b, 'website') }); } catch (e) { fail(res, e.status || 500, e.message); }
});

pub.post('/contact', limit('contact', 6, 3600000), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  if (!b.name || !b.body || (!b.email && !b.phone)) return fail(res, 400, 'Please include your name, a message, and an email or phone number.');
  const id = insert('messages', { name: String(b.name).slice(0, 120), email: String(b.email || '').slice(0, 200), phone: String(b.phone || '').slice(0, 40), subject: String(b.subject || '').slice(0, 200), body: String(b.body).slice(0, 5000), created_at: now() });
  notifyOwner(`New message from ${b.name}`, `${b.subject || ''}\n\n${b.body}\n\n${b.email || ''} ${b.phone || ''}`, 'message').catch(() => {});
  res.json({ ok: true, id });
});

// ----- customer quote page -----
const quoteView = (q) => {
  const c = one('SELECT name FROM customers WHERE id=?', q.customer_id);
  const expired = q.status === 'sent' && q.valid_until && q.valid_until < today();
  return {
    number: q.number, status: expired ? 'expired' : q.status, title: q.title, items: parse(q.items, []), tax_rate: q.tax_rate, subtotal_cents: q.subtotal_cents, tax_cents: q.tax_cents, total_cents: q.total_cents,
    deposit_cents: Math.round((q.total_cents * q.deposit_pct) / 100), deposit_pct: q.deposit_pct, valid_until: q.valid_until, notes: q.notes, trip: parse(q.trip, {}), customer_name: c?.name,
    vehicle: one('SELECT name FROM vehicles WHERE id=?', parse(q.trip, {}).vehicle_id)?.name,
    revision: q.revision || 1,
    revisions: all('SELECT revision, changed_at, reason, changes, total_before, total_after FROM quote_revisions WHERE quote_id=? ORDER BY revision DESC LIMIT 5', q.id).map((r) => ({ ...r, changes: parse(r.changes, []).filter((c) => c.label !== 'Note to customer') })),
  };
};
pub.get('/quote/:token', (req, res) => {
  const q = one('SELECT * FROM quotes WHERE token=?', req.params.token);
  if (!q || q.status === 'draft') return fail(res, 404, 'Quote not found');
  if (!q.viewed_at) { update('quotes', q.id, { viewed_at: now() }); log('customer', 'quote.viewed', 'quote', q.id); }
  const inv = q.status === 'accepted' ? one('SELECT token FROM invoices WHERE quote_id=?', q.id) : null;
  res.json({ ...quoteView(q), invoice_token: inv?.token, business: { name: getSetting('business_name'), phone: getSetting('phone'), email: getSetting('email') } });
});
pub.post('/quote/:token/accept', limit('qa', 10, 3600000), async (req, res) => {
  const q = one('SELECT * FROM quotes WHERE token=?', req.params.token);
  if (!q) return fail(res, 404, 'Quote not found');
  if (q.status === 'accepted') return res.json({ ok: true, invoice_token: one('SELECT token FROM invoices WHERE quote_id=?', q.id)?.token });
  if (q.status !== 'sent') return fail(res, 400, 'This quote can no longer be accepted. Please contact us.');
  if (q.valid_until && q.valid_until < today()) return fail(res, 400, 'This quote has expired. Contact us and we will refresh it.');
  const b = req.body || {};
  const mustSign = getSetting('require_signature') === '1';
  if (mustSign && !(b.signature && b.name && b.agree)) return fail(res, 400, 'Please type your name, draw your signature and check the agreement box.');
  try {
    // build the agreement from the quote exactly as the customer saw it, then accept + sign in one step
    const k = (b.signature && b.name) ? createContract({ quote_id: q.id }) : null;
    if (k) await signContract(k, b, { ip: req.ip, ua: req.headers['user-agent'] });
    const r = acceptQuote(q.id, 'customer');
    if (k) { update('contracts', k.id, { trip_id: r.trip_id }); }
    if (b.sms_optin && q.customer_id) { run('UPDATE customers SET sms_optin=1, sms_optin_at=? WHERE id=? AND sms_optin=0', now(), q.customer_id); }
    res.json({ ok: true, invoice_token: one('SELECT token FROM invoices WHERE id=?', r.invoice_id)?.token });
  } catch (e) { fail(res, e.status || 500, e.message); }
});
pub.post('/quote/:token/decline', limit('qd', 10, 3600000), (req, res) => {
  const q = one('SELECT * FROM quotes WHERE token=?', req.params.token);
  if (!q || q.status !== 'sent') return fail(res, 400, 'Cannot decline this quote.');
  update('quotes', q.id, { status: 'declined', declined_at: now(), updated_at: now() });
  if (q.request_id) update('requests', q.request_id, { status: 'lost', updated_at: now() });
  notifyOwner(`Quote ${q.number} declined`, String(req.body?.reason || 'No reason given').slice(0, 1000), 'quote_declined').catch(() => {});
  log('customer', 'quote.declined', 'quote', q.id);
  res.json({ ok: true });
});
pub.post('/quote/:token/question', limit('qq', 6, 3600000), (req, res) => {
  const q = one('SELECT * FROM quotes WHERE token=?', req.params.token);
  if (!q || !req.body?.message) return fail(res, 400, 'Missing message');
  const c = one('SELECT * FROM customers WHERE id=?', q.customer_id) || {};
  insert('messages', { name: c.name, email: c.email, phone: c.phone, subject: `Question about quote ${q.number}`, body: String(req.body.message).slice(0, 3000), created_at: now() });
  notifyOwner(`Question on quote ${q.number}`, `${c.name}: ${req.body.message}`, 'message').catch(() => {});
  res.json({ ok: true });
});

// ----- invoice payment -----
const invView = (i) => {
  const c = one('SELECT name FROM customers WHERE id=?', i.customer_id);
  const bal = invoiceBalance(i);
  const depDue = i.deposit_cents && i.amount_paid_cents < i.deposit_cents ? Math.min(bal, i.deposit_cents - i.amount_paid_cents) : 0;
  return {
    number: i.number, status: i.status, title: i.title, items: parse(i.items, []), tax_rate: i.tax_rate, subtotal_cents: i.subtotal_cents, tax_cents: i.tax_cents, gratuity_cents: i.gratuity_cents || 0, total_cents: i.total_cents,
    card: one('SELECT card_brand b, card_last4 l FROM customers WHERE id=? AND card_pm IS NOT NULL', i.customer_id) || null,
    paid_cents: i.amount_paid_cents, balance_cents: bal, deposit_due_cents: depDue, due_date: i.due_date, notes: i.notes, customer_name: c?.name, overdue: ['sent', 'partial'].includes(i.status) && i.due_date && i.due_date < today(),
    payments: all("SELECT amount_cents,method,created_at FROM payments WHERE invoice_id=? AND status='succeeded' ORDER BY id", i.id),
    trip: i.trip_id ? one('SELECT pickup,dropoff,depart_at,return_at,passengers FROM trips WHERE id=?', i.trip_id) : null,
    payments_enabled: integ().stripe, business: { name: getSetting('business_name'), phone: getSetting('phone'), email: getSetting('email') },
  };
};
pub.get('/invoice/:token', (req, res) => {
  const i = one('SELECT * FROM invoices WHERE token=?', req.params.token);
  if (!i || i.status === 'draft') return fail(res, 404, 'Invoice not found');
  res.json(invView(i));
});
pub.post('/invoice-lookup', limit('lookup', 10, 3600000), (req, res) => {
  const num = String(req.body?.number || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const row = num && email ? one("SELECT i.token FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE upper(i.number)=? AND lower(c.email)=? AND i.status<>'draft'", num, email) : null;
  if (!row) return fail(res, 404, 'We could not find that invoice. Check the number and the email it was sent to.');
  res.json({ token: row.token });
});
pub.post('/invoice/:token/pay', limit('pay', 20, 3600000), async (req, res) => {
  const i = one('SELECT * FROM invoices WHERE token=?', req.params.token);
  if (!i || i.status === 'draft' || i.status === 'void') return fail(res, 404, 'Invoice not found');
  const v = invView(i);
  if (v.balance_cents <= 0) return fail(res, 400, 'This invoice is already paid.');
  let amount = v.balance_cents;
  const mode = req.body?.mode;
  if (mode === 'deposit' && v.deposit_due_cents) amount = v.deposit_due_cents;
  else if (mode === 'custom') amount = Math.round(Number(req.body.amount_cents));
  if (!Number.isFinite(amount) || amount < 100 || amount > v.balance_cents) return fail(res, 400, `Enter an amount between $1.00 and ${money(v.balance_cents)}.`);
  try {
    const c = one('SELECT email FROM customers WHERE id=?', i.customer_id);
    const saveCard = !!req.body?.save_card;
    const cust = one('SELECT * FROM customers WHERE id=?', i.customer_id);
    const stripeCustomer = saveCard && cust ? await stripeCustomerFor(cust) : cust?.stripe_customer_id || undefined;
    const s = await createCheckout({ invoice: i, amount_cents: amount, email: c?.email, saveCard, stripeCustomer });
    res.json({ url: s.url });
  } catch (e) { fail(res, 502, e.message); }
});

// ----- Stripe webhook (raw body) -----
export const stripeWebhook = async (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  if (!verifyStripe(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) return res.status(400).send('bad signature');
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  try { await applyStripeEvent(ev); } catch (e) { console.error('webhook error', e); return res.status(500).send('error'); }
  res.json({ received: true });
};

// ----- Google Places (server-side proxy; address suggestions everywhere) -----
pub.get('/places/autocomplete', limit('places', 120, 600000), async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 3) return res.json([]);
  try { res.json(await placesAutocomplete(q, String(req.query.st || '').slice(0, 64))); } catch (e) { res.json([]); }
});
pub.get('/places/details', limit('placesd', 120, 600000), async (req, res) => {
  try { res.json(await placeDetails(String(req.query.id || '').slice(0, 200), String(req.query.st || '').slice(0, 64))); } catch (e) { fail(res, 502, e.message); }
});

// ----- contract signing page API -----
pub.get('/contract/:token', (req, res) => {
  const k = one('SELECT * FROM contracts WHERE token=?', req.params.token);
  if (!k || k.status === 'draft') return fail(res, 404, 'Agreement not found');
  res.json(contractView(k));
});
pub.post('/contract/:token/sign', limit('sign', 10, 3600000), async (req, res) => {
  const k = one('SELECT * FROM contracts WHERE token=?', req.params.token);
  if (!k || k.status === 'draft') return fail(res, 404, 'Agreement not found');
  try {
    await signContract(k, req.body || {}, { ip: req.ip, ua: req.headers['user-agent'] });
    const inv = k.quote_id ? one('SELECT token FROM invoices WHERE quote_id=?', k.quote_id) : k.trip_id ? one('SELECT token FROM invoices WHERE trip_id=? ORDER BY id LIMIT 1', k.trip_id) : null;
    res.json({ ok: true, invoice_token: inv?.token });
  } catch (e) { fail(res, e.status || 500, e.message); }
});
pub.get('/contract/:token/pdf', (req, res) => {
  const k = one('SELECT * FROM contracts WHERE token=?', req.params.token); const f = k && contractPdfPath(k);
  if (!f || !fs.existsSync(f)) return fail(res, 404, 'Not signed yet');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${k.number}.pdf"`); res.send(fs.readFileSync(f));
});

// ----- add-to-calendar for customers, and cookie-less traffic beacon -----
pub.get('/trip-ics/:slug', (req, res) => {
  const m = /^(\d+)-([a-f0-9]+)\.ics$/.exec(req.params.slug);
  const ics = m && customerTripIcs(Number(m[1]), m[2]);
  if (!ics) return fail(res, 404, 'Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="trip.ics"'); res.send(ics);
});
pub.post('/t', limit('beacon', 300, 600000), (req, res) => {
  try { trackView({ path: req.body?.p, ref: req.body?.r, sid: req.body?.s, ua: req.headers['user-agent'], country: req.headers['cf-ipcountry'] }); } catch {}
  res.status(204).end();
});

// ----- optional inbound text webhook (SimpleSender polling is the default; use this if they add webhooks) -----
pub.post('/sms-inbound', (req, res) => {
  const secret = env('SMS_WEBHOOK_SECRET');
  if (!secret || (req.headers['x-webhook-secret'] || req.query.secret) !== secret) return res.status(403).json({ error: 'forbidden' });
  const { from, body, id } = req.body || {};
  if (!from || typeof body !== 'string') return fail(res, 400, 'from and body required');
  handleInboundText(String(from), body, id ? String(id) : null);
  res.json({ ok: true });
});
