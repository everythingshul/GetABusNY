// Business logic shared by public, admin, driver and bot routes.
import { db, all, one, run, insert, update, tx, now, token, nextNumber, totals, parse, getSetting, log } from './db.js';
import { sendEmail, emailShell, esc, money, BASE_URL, notifyOwner, sendSMS } from './integrations.js';
import { normItinerary, fromLegacy, summarize, itineraryText, KINDS, mapsDirUrl } from './itinerary.js';

// ---------- time helpers (trip times are "naive" local times in the business timezone) ----------
const tz = () => getSetting('timezone') || 'America/New_York';
function tzOffsetMs(date, zone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}
export function localToDate(naive) {
  if (!naive) return null;
  const s = naive.length === 10 ? naive + 'T09:00:00' : naive.length === 16 ? naive + ':00' : naive;
  const guess = new Date(s + 'Z');
  return new Date(guess.getTime() - tzOffsetMs(guess, tz()));
}
export const naiveMs = (naive) => (naive ? Date.parse((naive.length === 16 ? naive + ':00' : naive) + 'Z') : NaN);
export function nowLocalMs() { const d = new Date(); return d.getTime() + tzOffsetMs(d, tz()); }
export const fmtWhen = (naive) => {
  if (!naive) return 'TBD';
  const d = new Date(naive.length === 10 ? naive + 'T00:00:00Z' : naive + ':00Z');
  return d.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...(naive.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}) });
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const addHours = (d, n) => new Date(d.getTime() + n * 3600000);
const nums = (s) => String(s || '').split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
const link = {
  quote: (q) => `${BASE_URL()}/quote/${q.token}`,
  pay: (i) => `${BASE_URL()}/pay/${i.token}`,
  vendor: (r) => `${BASE_URL()}/v/${r.token}`,
  driver: (d) => `${BASE_URL()}/d/${d.token}`,
};
export { link };

// ---------- customers ----------
export function ensureCustomer({ name, email, phone, company, sms_optin }) {
  email = (email || '').trim().toLowerCase();
  let c = email ? one('SELECT * FROM customers WHERE lower(email)=?', email) : null;
  if (c) {
    update('customers', c.id, { name: c.name || name, phone: c.phone || phone, company: c.company || company, updated_at: now(), ...(sms_optin && !c.sms_optin ? { sms_optin: 1, sms_optin_at: now() } : {}) });
    return c.id;
  }
  return insert('customers', { name, email, phone, company, sms_optin: sms_optin ? 1 : 0, sms_optin_at: sms_optin ? now() : null, created_at: now(), updated_at: now() });
}

// ---------- requests (leads) ----------
export function createRequest(d, source = 'website') {
  const name = String(d.name || '').trim().slice(0, 120);
  const email = String(d.email || '').trim().slice(0, 200);
  const phone = String(d.phone || '').trim().slice(0, 40);
  if (!name || (!email && !phone)) throw Object.assign(new Error('Name and an email or phone number are required.'), { status: 400 });
  const customer_id = ensureCustomer({ name, email, phone, company: d.company, sms_optin: !!d.sms_optin && !!phone });
  let itinerary = normItinerary(d.itinerary);
  if (!itinerary.length) itinerary = fromLegacy(d);
  else {
    if (d.pickup && !itinerary.some((x) => x.kind === 'pickup')) itinerary = normItinerary([{ kind: 'pickup', address: d.pickup, time: d.depart_at }, ...itinerary]);
    if (d.dropoff && !itinerary.some((x) => x.kind === 'dropoff')) itinerary = normItinerary([...itinerary, { kind: 'dropoff', address: d.dropoff }]);
  }
  const flat = summarize(itinerary);
  const details = {
    trip_type: d.trip_type || 'round_trip', purpose: String(d.purpose || '').slice(0, 80), itinerary,
    pickup: flat.pickup || d.pickup, dropoff: flat.dropoff || d.dropoff, stops: flat.stops || d.stops,
    depart_at: d.depart_at || flat.depart_at, return_at: d.return_at || flat.return_at, passengers: Number(d.passengers) || null,
    vehicle_id: d.vehicle_id ? Number(d.vehicle_id) : null, vehicle_pref: d.vehicle_pref, comments: String(d.comments || '').slice(0, 3000),
  };
  const ref = nextNumber('REQ', 1001);
  const id = insert('requests', { ref, customer_id, name, email, phone, details, status: 'new', source, referred_by: d.referred_by, created_at: now(), updated_at: now() });
  log(source, 'request.created', 'request', id, `${name} ${details.depart_at || ''}`);
  const veh = details.vehicle_id ? one('SELECT name FROM vehicles WHERE id=?', details.vehicle_id)?.name : 'No preference';
  notifyOwner(`New quote request ${ref} — ${name}`,
    `${name}\n${email} ${phone}${d.sms_optin ? ' (OK to text)' : ''}\n\nPurpose: ${details.purpose || '—'}\nDepart: ${fmtWhen(details.depart_at)}\nReturn: ${fmtWhen(details.return_at)}\nPassengers: ${details.passengers || '?'}\nVehicle: ${veh}\n\nItinerary:\n${itineraryText(itinerary) || '—'}\n\n${details.comments || ''}`).catch(() => {});
  if (email) {
    sendEmail(email, `We got your request (${ref})`, emailShell(`Thanks, ${name.split(' ')[0]} — we have your request`,
      `<p>Your reference number is <b>${ref}</b>. We'll send your quote during business hours, usually the same day.</p>
       <p>${details.purpose ? `<b>Trip:</b> ${esc(details.purpose)}<br>` : ''}<b>Depart:</b> ${fmtWhen(details.depart_at)}<br><b>Passengers:</b> ${details.passengers || '—'}</p><p><b>Itinerary</b><br>${esc(itineraryText(itinerary)).replace(/\n/g, '<br>')}</p>
       <p>Need it faster? Call ${esc(getSetting('phone'))}.</p>`)).catch(() => {});
  }
  scheduleTask('request', id, 'lead_call', `Call new lead: ${name} (${ref})`, addHours(new Date(), 1));
  if (d.sms_optin && phone) textCustomer(customer_id, `${getSetting('business_name')}: we got your trip request ${ref}. We'll send your quote during business hours. Reply STOP to opt out.`, 'request_received', { force: true }).catch(() => {});
  return { id, ref };
}

// ---------- quotes ----------
export function recalcQuote(id) {
  const q = one('SELECT * FROM quotes WHERE id=?', id);
  update('quotes', id, { ...totals(parse(q.items, []), q.tax_rate), updated_at: now() });
}
export function quoteFromRequest(request_id) {
  const r = one('SELECT * FROM requests WHERE id=?', request_id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  const d = parse(r.details, {});
  const days = Number(getSetting('quote_valid_days')) || 7;
  const id = insert('quotes', {
    number: nextNumber('Q', 1001), customer_id: r.customer_id, request_id: r.id, status: 'draft',
    title: `${d.pickup || 'Charter'} → ${d.dropoff || ''}`.trim(), items: [{ desc: 'Charter service', qty: 1, unit_cents: 0 }],
    tax_rate: Number(getSetting('tax_rate')) || 0, deposit_pct: Number(getSetting('deposit_pct')) || 50,
    valid_until: addDays(new Date(), days).toISOString().slice(0, 10), trip: { purpose: d.purpose, itinerary: d.itinerary?.length ? d.itinerary : fromLegacy(d), pickup: d.pickup, dropoff: d.dropoff, stops: d.stops, depart_at: d.depart_at, return_at: d.return_at, passengers: d.passengers, vehicle_id: d.vehicle_id, notes: d.comments },
    token: token(), created_at: now(), updated_at: now(),
  });
  update('requests', r.id, { status: 'quoting', updated_at: now() });
  return id;
}
function customerOf(id) { return one('SELECT * FROM customers WHERE id=?', id) || {}; }

export async function sendQuote(id, actor) {
  const q = one('SELECT * FROM quotes WHERE id=?', id);
  const c = customerOf(q.customer_id);
  if (!c.email) throw Object.assign(new Error('Customer has no email.'), { status: 400 });
  if (!q.total_cents) throw Object.assign(new Error('Quote total is $0 — add pricing first.'), { status: 400 });
  const t = parse(q.trip, {});
  const html = emailShell(`Your quote ${q.number}`,
    `<p>Hi ${esc(c.name.split(' ')[0])},</p><p>Thanks for considering ${esc(getSetting('business_name'))}. Here's your quote for <b>${esc(q.title || 'your trip')}</b>.</p>
     <p><b>Depart:</b> ${fmtWhen(t.depart_at)}<br><b>Return:</b> ${fmtWhen(t.return_at)}<br><b>Passengers:</b> ${t.passengers || '—'}<br><b>Total:</b> ${money(q.total_cents)}</p>
     <p>The quote is good until ${q.valid_until || 'further notice'}. You can review the details, accept it, and pay your deposit online.</p>`, { label: 'View & accept quote', url: link.quote(q) });
  const r = await sendEmail(c.email, `Quote ${q.number} from ${getSetting('business_name')}`, html);
  update('quotes', id, { status: 'sent', sent_at: now(), updated_at: now() });
  textCustomer(q.customer_id, `${getSetting('business_name')}: your quote ${q.number} is ready: ${link.quote(q)}`, 'quote_sent', { force: true }).catch(() => {});
  if (q.request_id) update('requests', q.request_id, { status: 'quoted', updated_at: now() });
  const days = nums(getSetting('fu_quote_days'));
  if (getSetting('fu_enabled') === '1') days.forEach((n) => scheduleAuto('quote', id, 'quote_nudge', addDays(new Date(), n)));
  log(actor, 'quote.sent', 'quote', id, c.email);
  return r;
}

export function acceptQuote(id, actor = 'customer') {
  const q = one('SELECT * FROM quotes WHERE id=?', id);
  if (!q) throw Object.assign(new Error('Quote not found'), { status: 404 });
  if (q.status === 'accepted') return { already: true, ...(one('SELECT id trip_id FROM trips WHERE quote_id=?', id) || {}) };
  const t = parse(q.trip, {});
  const out = tx(() => {
    update('quotes', id, { status: 'accepted', accepted_at: now(), updated_at: now() });
    const ref = nextNumber('TRIP', 1001);
    const tripId = insert('trips', {
      ref, customer_id: q.customer_id, quote_id: id, status: 'booked', title: q.title, purpose: t.purpose, itinerary: normItinerary(t.itinerary), pickup: t.pickup, dropoff: t.dropoff, stops: t.stops,
      depart_at: t.depart_at, return_at: t.return_at, passengers: t.passengers, vehicle_id: t.vehicle_id, price_cents: q.total_cents, notes: t.notes, created_at: now(), updated_at: now(),
    });
    const deposit = Math.round((q.total_cents * (q.deposit_pct || 0)) / 100);
    const due = addDays(new Date(), Number(getSetting('invoice_due_days')) || 7).toISOString().slice(0, 10);
    const invId = insert('invoices', {
      number: nextNumber('INV', 1001), customer_id: q.customer_id, trip_id: tripId, quote_id: id, status: 'draft', title: q.title, items: q.items, tax_rate: q.tax_rate,
      ...totals(parse(q.items, []), q.tax_rate), deposit_cents: deposit, due_date: due, token: token(), created_at: now(), updated_at: now(),
    });
    if (q.request_id) {
      update('requests', q.request_id, { status: 'converted', updated_at: now() });
      const win = one("SELECT * FROM rfqs WHERE request_id=? AND status='accepted'", q.request_id);
      if (win) update('trips', tripId, { vendor_id: win.vendor_id, vendor_cost_cents: win.price_cents || 0 });
    }
    return { tripId, invId };
  });
  log(actor, 'quote.accepted', 'quote', id, `trip ${out.tripId}`);
  scheduleTripFollowups(out.tripId);
  sendInvoice(out.invId, actor).catch(() => {});
  notifyOwner(`Quote ${q.number} accepted`, `${customerOf(q.customer_id).name} accepted ${q.number} (${money(q.total_cents)}). Trip and invoice created.`).catch(() => {});
  return { trip_id: out.tripId, invoice_id: out.invId };
}

// ---------- invoices ----------
export function recalcInvoice(id) {
  const i = one('SELECT * FROM invoices WHERE id=?', id);
  const t = totals(parse(i.items, []), i.tax_rate);
  const paid = one("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE invoice_id=? AND status='succeeded'", id).s;
  let status = i.status;
  if (status !== 'void' && status !== 'draft') status = paid >= t.total_cents && t.total_cents > 0 ? 'paid' : paid > 0 ? 'partial' : 'sent';
  update('invoices', id, { ...t, amount_paid_cents: paid, status, paid_at: status === 'paid' ? i.paid_at || now() : null, updated_at: now() });
}
export const invoiceBalance = (i) => Math.max(0, i.total_cents - i.amount_paid_cents);

export async function sendInvoice(id, actor) {
  recalcInvoice(id);
  let i = one('SELECT * FROM invoices WHERE id=?', id);
  const c = customerOf(i.customer_id);
  if (!c.email) throw Object.assign(new Error('Customer has no email.'), { status: 400 });
  if (i.status === 'draft') update('invoices', id, { status: 'sent', sent_at: now() });
  recalcInvoice(id);
  i = one('SELECT * FROM invoices WHERE id=?', id);
  const due = i.deposit_cents && i.amount_paid_cents < i.deposit_cents ? `Deposit due now: <b>${money(i.deposit_cents - i.amount_paid_cents)}</b><br>` : '';
  const r = await sendEmail(c.email, `Invoice ${i.number} — ${money(invoiceBalance(i))} due`, emailShell(`Invoice ${i.number}`,
    `<p>Hi ${esc(c.name.split(' ')[0])},</p><p>${esc(i.title || 'Charter service')}</p>
     <p>Total: <b>${money(i.total_cents)}</b><br>Paid: ${money(i.amount_paid_cents)}<br>Balance: <b>${money(invoiceBalance(i))}</b><br>${due}Due date: ${i.due_date || 'on receipt'}</p>`, { label: 'Pay securely online', url: link.pay(i) }));
  if (!one("SELECT 1 x FROM followups WHERE entity_type='invoice' AND entity_id=? AND auto=1", id) && getSetting('fu_enabled') === '1' && i.due_date) {
    const due0 = new Date(i.due_date + 'T14:00:00Z');
    nums(getSetting('fu_invoice_before_days')).forEach((n) => scheduleAuto('invoice', id, 'invoice_reminder', addDays(due0, -n)));
    scheduleAuto('invoice', id, 'invoice_reminder', due0);
    nums(getSetting('fu_invoice_after_days')).forEach((n) => scheduleAuto('invoice', id, 'invoice_reminder', addDays(due0, n)));
  }
  log(actor, 'invoice.sent', 'invoice', id, c.email);
  return r;
}

export function recordPayment(invoice_id, { amount_cents, method = 'manual', reference, stripe_session, stripe_pi, note }, actor = 'admin') {
  if (stripe_session && one('SELECT 1 x FROM payments WHERE stripe_session=?', stripe_session)) return null; // webhook replay
  const pid = insert('payments', { invoice_id, amount_cents, method, reference, stripe_session, stripe_pi, status: 'succeeded', note, created_at: now() });
  const before = one('SELECT status FROM invoices WHERE id=?', invoice_id).status;
  if (before === 'draft') update('invoices', invoice_id, { status: 'sent' });
  recalcInvoice(invoice_id);
  const i = one('SELECT * FROM invoices WHERE id=?', invoice_id);
  if (i.trip_id && i.amount_paid_cents >= (i.deposit_cents || i.total_cents)) {
    run("UPDATE trips SET status='confirmed', updated_at=? WHERE id=? AND status='booked'", now(), i.trip_id);
  }
  const c = customerOf(i.customer_id);
  log(actor, 'payment.recorded', 'invoice', invoice_id, `${money(amount_cents)} ${method}`);
  if (c.email) sendEmail(c.email, `Payment received — ${i.number}`, emailShell('Payment received', `<p>Thank you. We received <b>${money(amount_cents)}</b> toward invoice ${i.number}.</p><p>Remaining balance: <b>${money(invoiceBalance(i))}</b></p>`, invoiceBalance(i) ? { label: 'Pay remaining balance', url: link.pay(i) } : null)).catch(() => {});
  textCustomer(i.customer_id, `${getSetting('business_name')}: payment of ${money(amount_cents)} received for ${i.number}. Balance: ${money(invoiceBalance(i))}. Thank you!`, 'payment', { force: true }).catch(() => {});
  notifyOwner(`Payment ${money(amount_cents)} — ${i.number}`, `${c.name} paid ${money(amount_cents)} (${method}). Balance ${money(invoiceBalance(i))}.`).catch(() => {});
  return pid;
}

// ---------- trips / drivers ----------
export function tripDetail(id) {
  const t = one('SELECT * FROM trips WHERE id=?', id);
  if (!t) return null;
  return { ...t, itinerary: normItinerary(parse(t.itinerary, [])), customer: customerOf(t.customer_id), vehicle: one('SELECT id,name,capacity,category FROM vehicles WHERE id=?', t.vehicle_id) || null, vendor: one('SELECT id,name,phone,contact_name FROM vendors WHERE id=?', t.vendor_id) || null, driver: one('SELECT id,name,phone FROM drivers WHERE id=?', t.driver_id) || null };
}
export async function sendDriverLink(driver_id, via = 'email') {
  const d = one('SELECT * FROM drivers WHERE id=?', driver_id);
  const url = link.driver(d);
  if (via === 'sms') return sendSMS(d.phone, `Get A Bus NY driver portal (no password needed): ${url}`);
  return sendEmail(d.email, 'Your Get A Bus NY driver portal link', emailShell('Your driver portal', `<p>Hi ${esc(d.name.split(' ')[0])}, this link shows your assigned trips and customer contact info on the day of the trip. No password needed — don't share it.</p>`, { label: 'Open driver portal', url }));
}
export async function sendTripConfirmation(trip_id) {
  const t = tripDetail(trip_id);
  if (!t.customer.email) throw Object.assign(new Error('Customer has no email.'), { status: 400 });
  return sendEmail(t.customer.email, `Trip confirmation ${t.ref} — ${fmtWhen(t.depart_at)}`, emailShell('Your trip is confirmed',
    `<p>Hi ${esc(t.customer.name.split(' ')[0])}, here are your trip details.</p>
     <p>${t.purpose ? `<b>Trip:</b> ${esc(t.purpose)}<br>` : ''}<b>Depart:</b> ${fmtWhen(t.depart_at)}<br><b>Return:</b> ${fmtWhen(t.return_at)}<br><b>Passengers:</b> ${t.passengers || '—'}<br><b>Vehicle:</b> ${esc(t.vehicle?.name || 'To be assigned')}</p>
     <p><b>Itinerary</b><br>${esc(itineraryText(t.itinerary.filter((x) => x.kind !== 'start' && x.kind !== 'end'))).replace(/\n/g, '<br>')}</p>
     <p>Your driver will contact you on the day of the trip. Questions? Call ${esc(getSetting('phone'))}.</p>`, { label: 'Add to my calendar', url: `${BASE_URL()}/api/public/trip-ics/${t.id}-${icsKey(t.id)}.ics` }));
}

// ---------- vendors / RFQs ----------
export async function sendRFQs({ request_id, trip_id, vendor_ids, message }) {
  let snap;
  if (trip_id) { const t = one('SELECT * FROM trips WHERE id=?', trip_id); snap = { purpose: t.purpose, itinerary: normItinerary(parse(t.itinerary, [])), pickup: t.pickup, dropoff: t.dropoff, stops: t.stops, depart_at: t.depart_at, return_at: t.return_at, passengers: t.passengers, vehicle: one('SELECT name FROM vehicles WHERE id=?', t.vehicle_id)?.name, notes: t.notes }; }
  else { const r = one('SELECT * FROM requests WHERE id=?', request_id); const d = parse(r.details, {}); snap = { purpose: d.purpose, itinerary: normItinerary(d.itinerary), pickup: d.pickup, dropoff: d.dropoff, stops: d.stops, depart_at: d.depart_at, return_at: d.return_at, passengers: d.passengers, vehicle: d.vehicle_id ? one('SELECT name FROM vehicles WHERE id=?', d.vehicle_id)?.name : d.vehicle_pref, notes: d.comments }; }
  const out = [];
  for (const vid of vendor_ids) {
    const v = one('SELECT * FROM vendors WHERE id=?', vid);
    if (!v) continue;
    const ref = nextNumber('RFQ', 1001);
    const id = insert('rfqs', { ref, request_id: request_id || null, trip_id: trip_id || null, vendor_id: vid, token: token(), status: 'sent', message, snapshot: snap, sent_at: now(), created_at: now() });
    const r = one('SELECT * FROM rfqs WHERE id=?', id);
    let res = { ok: false, error: 'Vendor has no email' };
    if (v.email) {
      res = await sendEmail(v.email, `Quote request ${ref}: ${snap.passengers || '?'} pax, ${fmtWhen(snap.depart_at)}`, emailShell(`Can you quote this trip?`,
        `<p>Hi ${esc(v.contact_name || v.name)},</p><p>We have a trip and would like your best price.</p>
         <p>${snap.purpose ? `<b>Trip:</b> ${esc(snap.purpose)}<br>` : ''}<b>Depart:</b> ${fmtWhen(snap.depart_at)}<br><b>Return:</b> ${fmtWhen(snap.return_at)}<br><b>Passengers:</b> ${snap.passengers || '—'}<br><b>Vehicle wanted:</b> ${esc(snap.vehicle || 'Any suitable')}</p>
         <p><b>Itinerary</b><br>${esc(itineraryText(snap.itinerary?.length ? snap.itinerary : fromLegacy(snap))).replace(/\n/g, '<br>')}</p>
         ${message ? `<p>${esc(message)}</p>` : ''}<p>Use the button to reply with your price or decline. No login needed.</p>`, { label: 'Send my price', url: link.vendor(r) }));
    }
    if (getSetting('fu_enabled') === '1') { const h = Number(getSetting('fu_rfq_hours')); if (h) scheduleAuto('rfq', id, 'rfq_nudge', addHours(new Date(), h)); }
    out.push({ rfq_id: id, vendor_id: vid, email: res });
  }
  log('admin', 'rfq.sent', trip_id ? 'trip' : 'request', trip_id || request_id, `${out.length} vendors`);
  return out;
}

export async function acceptRFQ(id) {
  const r = one('SELECT * FROM rfqs WHERE id=?', id);
  if (!r) throw Object.assign(new Error('RFQ not found'), { status: 404 });
  tx(() => {
    update('rfqs', id, { status: 'accepted' });
    run("UPDATE rfqs SET status='closed' WHERE id<>? AND status IN ('sent','responded') AND ((request_id IS NOT NULL AND request_id=?) OR (trip_id IS NOT NULL AND trip_id=?))", id, r.request_id ?? -1, r.trip_id ?? -1);
    let tripId = r.trip_id;
    if (!tripId && r.request_id) tripId = one('SELECT t.id FROM trips t JOIN quotes q ON q.id=t.quote_id WHERE q.request_id=?', r.request_id)?.id;
    if (tripId) update('trips', tripId, { vendor_id: r.vendor_id, vendor_cost_cents: r.price_cents || 0, updated_at: now() });
  });
  const v = one('SELECT * FROM vendors WHERE id=?', r.vendor_id);
  if (v?.email) sendEmail(v.email, `You got the trip — ${r.ref}`, emailShell('Your quote was accepted', `<p>We'd like to book this trip with you at <b>${money(r.price_cents)}</b>. We'll follow up with final details shortly.</p>`)).catch(() => {});
  log('admin', 'rfq.accepted', 'rfq', id, v?.name);
}

// ---------- follow-ups ----------
export function scheduleAuto(entity_type, entity_id, kind, due) {
  return insert('followups', { entity_type, entity_id, kind, channel: 'email', due_at: due.toISOString(), status: 'pending', auto: 1, created_at: now() });
}
export function scheduleTask(entity_type, entity_id, kind, subject, due, body = '') {
  return insert('followups', { entity_type, entity_id, kind, channel: 'task', subject, body, due_at: due.toISOString(), status: 'pending', auto: 0, created_at: now() });
}
export function scheduleTripFollowups(trip_id) {
  if (getSetting('fu_enabled') !== '1') return;
  const t = one('SELECT * FROM trips WHERE id=?', trip_id);
  const dep = localToDate(t.depart_at), ret = localToDate(t.return_at || t.depart_at);
  const h = Number(getSetting('fu_trip_confirm_hours'));
  if (dep && h) scheduleAuto('trip', trip_id, 'trip_confirm', addHours(dep, -h));
  const d = Number(getSetting('fu_trip_thanks_days'));
  if (ret && d) scheduleAuto('trip', trip_id, 'trip_thanks', addDays(ret, d));
}

/** Decide whether an auto follow-up should still go out, and build the email. */
function composeFollowup(f) {
  if (f.entity_type === 'quote') {
    const q = one('SELECT * FROM quotes WHERE id=?', f.entity_id);
    if (!q || q.status !== 'sent') return null;
    const c = customerOf(q.customer_id);
    return { to: c.email, subject: `Still need a bus? Quote ${q.number}`, html: emailShell('Just checking in', `<p>Hi ${esc((c.name || '').split(' ')[0])}, we sent over quote ${q.number} (${money(q.total_cents)}) and wanted to make sure you got it. Dates can fill up, especially weekends — reply with any questions or changes and we'll update it.</p>`, { label: 'View your quote', url: link.quote(q) }) };
  }
  if (f.entity_type === 'invoice') {
    const i = one('SELECT * FROM invoices WHERE id=?', f.entity_id);
    if (!i || !['sent', 'partial'].includes(i.status)) return null;
    const c = customerOf(i.customer_id);
    const late = i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
    return { to: c.email, subject: late ? `Past due: invoice ${i.number}` : `Reminder: invoice ${i.number} due ${i.due_date}`, html: emailShell(late ? 'Your invoice is past due' : 'Payment reminder', `<p>Hi ${esc((c.name || '').split(' ')[0])}, invoice ${i.number} has a balance of <b>${money(invoiceBalance(i))}</b>${i.due_date ? `, due ${i.due_date}` : ''}. If you already paid, thank you — ignore this note.</p>`, { label: 'Pay online', url: link.pay(i) }) };
  }
  if (f.entity_type === 'trip') {
    const t = one('SELECT * FROM trips WHERE id=?', f.entity_id);
    if (!t || t.status === 'cancelled') return null;
    const c = customerOf(t.customer_id);
    if (f.kind === 'trip_confirm') {
      if (!['booked', 'confirmed'].includes(t.status)) return null;
      textCustomer(c.id, `${getSetting('business_name')}: reminder — your trip departs ${fmtWhen(t.depart_at)} from ${t.pickup || 'your pickup location'}. Questions? ${getSetting('phone')}`, 'trip_reminder', { trip_id: t.id }).catch(() => {});
      return { to: c.email, subject: `Reminder: your trip ${fmtWhen(t.depart_at)}`, html: emailShell('Your trip is coming up', `<p>Pickup: <b>${esc(t.pickup || '')}</b><br>Time: <b>${fmtWhen(t.depart_at)}</b><br>Please have your group ready 10 minutes early. Your driver will call or text you before pickup. Need to change something? Call ${esc(getSetting('phone'))}.</p>`) };
    }
    if (f.kind === 'trip_thanks') { run('UPDATE trips SET review_sent_at=? WHERE id=?', now(), t.id); if (c.sms_optin && c.phone) textCustomer(c.id, reviewText(), 'review_request', { trip_id: t.id }).catch(() => {}); }
    return { to: c.email, subject: 'Thanks for riding with us', html: reviewEmail(c) };
  }
  if (f.entity_type === 'rfq') {
    const r = one('SELECT * FROM rfqs WHERE id=?', f.entity_id);
    if (!r || r.status !== 'sent') return null;
    const v = one('SELECT * FROM vendors WHERE id=?', r.vendor_id);
    return { to: v?.email, subject: `Reminder: quote request ${r.ref}`, html: emailShell('Still waiting on your price', `<p>We haven't heard back on this quote request. A quick price or a decline helps us plan.</p>`, { label: 'Reply now', url: link.vendor(r) }) };
  }
  return null;
}

let running = false;
export async function runFollowups() {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    const due = all("SELECT * FROM followups WHERE status='pending' AND auto=1 AND due_at<=? ORDER BY due_at LIMIT 50", now());
    for (const f of due) {
      try {
        const msg = composeFollowup(f);
        if (!msg || !msg.to) { update('followups', f.id, { status: 'skipped', done_at: now(), result: msg ? 'no recipient' : 'no longer needed' }); continue; }
        const r = await sendEmail(msg.to, msg.subject, msg.html);
        update('followups', f.id, { status: r.ok ? 'sent' : 'failed', done_at: now(), subject: msg.subject, to_email: msg.to, result: r.error || r.status });
        n++;
      } catch (e) { update('followups', f.id, { status: 'failed', done_at: now(), result: e.message }); }
    }
    await flushSMS();
    // mark overdue invoices
    // (status stays sent/partial; "overdue" is derived from due_date in queries)
  } finally { running = false; }
  return n;
}

// ---------- analytics ----------
export function analytics(months = 12) {
  const since = new Date(); since.setMonth(since.getMonth() - months + 1); since.setDate(1);
  const s = since.toISOString().slice(0, 10);
  const revenue = all("SELECT substr(created_at,1,7) m, SUM(amount_cents) c FROM payments WHERE status='succeeded' AND created_at>=? GROUP BY m ORDER BY m", s);
  const leads = all('SELECT substr(created_at,1,7) m, COUNT(*) c FROM requests WHERE created_at>=? GROUP BY m ORDER BY m', s);
  const bySource = all('SELECT COALESCE(source,\'unknown\') k, COUNT(*) c FROM requests GROUP BY k ORDER BY c DESC');
  const byRef = all("SELECT referred_by k, COUNT(*) c FROM requests WHERE referred_by<>'' AND referred_by IS NOT NULL GROUP BY k ORDER BY c DESC LIMIT 8");
  const funnel = {
    leads: one('SELECT COUNT(*) c FROM requests').c,
    quoted: one("SELECT COUNT(*) c FROM quotes WHERE status IN ('sent','accepted','declined','expired')").c,
    accepted: one("SELECT COUNT(*) c FROM quotes WHERE status='accepted'").c,
    completed: one("SELECT COUNT(*) c FROM trips WHERE status='completed'").c,
  };
  const quoteStats = one("SELECT COUNT(*) n, COALESCE(AVG(total_cents),0) avg FROM quotes WHERE status IN ('sent','accepted','declined','expired')");
  const margin = one("SELECT COALESCE(SUM(price_cents),0) rev, COALESCE(SUM(vendor_cost_cents),0) cost FROM trips WHERE vendor_id IS NOT NULL AND status<>'cancelled'");
  const topVehicles = all("SELECT v.name k, COUNT(*) c, SUM(t.price_cents) rev FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.status<>'cancelled' GROUP BY v.id ORDER BY c DESC LIMIT 8");
  const topVendors = all("SELECT v.name k, COUNT(*) c, SUM(t.vendor_cost_cents) cost, SUM(t.price_cents) rev FROM trips t JOIN vendors v ON v.id=t.vendor_id WHERE t.status<>'cancelled' GROUP BY v.id ORDER BY c DESC LIMIT 8");
  const topCustomers = all("SELECT c.name k, COUNT(*) c, SUM(t.price_cents) rev FROM trips t JOIN customers c ON c.id=t.customer_id WHERE t.status<>'cancelled' GROUP BY c.id ORDER BY rev DESC LIMIT 8");
  const today = new Date().toISOString().slice(0, 10);
  const ar = one("SELECT COALESCE(SUM(total_cents-amount_paid_cents),0) open, COALESCE(SUM(CASE WHEN due_date<? THEN total_cents-amount_paid_cents ELSE 0 END),0) overdue FROM invoices WHERE status IN ('sent','partial')", today);
  const vendorResp = one("SELECT COUNT(*) sent, SUM(CASE WHEN status IN ('responded','accepted','closed') THEN 1 ELSE 0 END) replied FROM rfqs");
  return { revenue, leads, bySource, byRef, funnel, quoteStats, margin, topVehicles, topVendors, topCustomers, ar, vendorResp, win_rate: funnel.quoted ? funnel.accepted / funnel.quoted : 0 };
}

export function dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);
  const weekEnd = addDays(new Date(), 7).toISOString().slice(0, 10);
  return {
    new_leads: one("SELECT COUNT(*) c FROM requests WHERE status='new'").c,
    quotes_out: one("SELECT COUNT(*) c, COALESCE(SUM(total_cents),0) v FROM quotes WHERE status='sent'"),
    unpaid: one("SELECT COUNT(*) c, COALESCE(SUM(total_cents-amount_paid_cents),0) v FROM invoices WHERE status IN ('sent','partial')"),
    overdue: one("SELECT COUNT(*) c FROM invoices WHERE status IN ('sent','partial') AND due_date<?", today).c,
    revenue_mtd: one("SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE status='succeeded' AND substr(created_at,1,7)=?", ym).v,
    trips_week: all("SELECT t.*, c.name customer_name, v.name vehicle_name, d.name driver_name FROM trips t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id WHERE t.status NOT IN ('cancelled','completed') AND substr(t.depart_at,1,10)>=? AND substr(t.depart_at,1,10)<=? ORDER BY t.depart_at", today, weekEnd),
    unassigned: one("SELECT COUNT(*) c FROM trips WHERE status IN ('booked','confirmed') AND (driver_id IS NULL OR vehicle_id IS NULL) AND substr(depart_at,1,10)>=?", today).c,
    followups_due: all("SELECT * FROM followups WHERE status='pending' AND auto=0 AND due_at<=? ORDER BY due_at LIMIT 20", addHours(new Date(), 12).toISOString()),
    rfqs_waiting: one("SELECT COUNT(*) c FROM rfqs WHERE status='responded'").c,
    unread_messages: one("SELECT COUNT(*) c FROM messages WHERE status='new'").c,
    activity: all('SELECT * FROM activity ORDER BY id DESC LIMIT 15'),
  };
}

// ---------- text messages (Twilio). Only to customers who opted in; Shabbos-aware quiet window ----------
export function toE164(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function weekMin(str) { const m = /^(\w{3})\w*\s+(\d{1,2}):(\d\d)/.exec(String(str || '').trim()); return m ? (DOW[m[1].toLowerCase()] ?? 0) * 1440 + Number(m[2]) * 60 + Number(m[3]) : null; }
export function inQuietWindow(localMs = nowLocalMs()) {
  const a = weekMin(getSetting('sms_quiet_start')), b = weekMin(getSetting('sms_quiet_end'));
  if (a == null || b == null) return false;
  const d = new Date(localMs); const w = d.getUTCDay() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
  return a <= b ? w >= a && w < b : w >= a || w < b;
}
function quietEndsAt() { // first real moment after the quiet window ends
  let t = Date.now();
  for (let i = 0; i < 400 && inQuietWindow(nowLocalMs() + (t - Date.now())); i++) t += 15 * 60000;
  return new Date(t);
}
export async function textCustomer(customer_id, body, kind, { trip_id, force = false, override = false } = {}) {
  const c = customerOf(customer_id);
  if (!c.id || !c.phone) return { ok: false, error: 'no phone' };
  if (!override && !c.sms_optin) return { ok: false, error: 'customer has not opted in to texts' };
  if (getSetting('sms_enabled') !== '1') return { ok: false, error: 'texts are turned off' };
  const to = toE164(c.phone); if (!to) return { ok: false, error: 'invalid phone number' };
  const defer = !force && inQuietWindow();
  const id = insert('sms_log', { to_phone: to, body: String(body).slice(0, 600), kind, status: defer ? 'queued' : 'sending', customer_id, trip_id: trip_id || null, send_after: defer ? quietEndsAt().toISOString() : null, created_at: now() });
  if (defer) return { ok: true, queued: true };
  return deliverSMS(id);
}
async function deliverSMS(id) {
  const m = one('SELECT * FROM sms_log WHERE id=?', id);
  const r = await sendSMS(m.to_phone, m.body);
  update('sms_log', id, { status: r.ok ? 'sent' : 'failed', error: r.error || null, sent_at: now() });
  return r;
}
export async function flushSMS() {
  for (const m of all("SELECT id, customer_id FROM sms_log WHERE status='queued' AND send_after<=? LIMIT 25", now())) {
    if (!customerOf(m.customer_id).sms_optin) { update('sms_log', m.id, { status: 'skipped', error: 'opted out' }); continue; }
    await deliverSMS(m.id);
  }
}

// ---------- review requests ----------
const reviewUrl = () => getSetting('google_review_url');
export const reviewText = () => `Thank you for riding with ${getSetting('business_name')}!${reviewUrl() ? ` If we did a good job, a quick Google review helps us a lot: ${reviewUrl()}` : ''} Reply STOP to opt out.`;
export function reviewEmail(c) {
  return emailShell('Thank you', `<p>Hi ${esc((c.name || '').split(' ')[0])}, thank you for choosing ${esc(getSetting('business_name'))}. If anything about your trip wasn't right, reply to this email and we'll make it right.</p>${reviewUrl() ? '<p>If it went well, a short Google review helps other groups find us.</p>' : ''}`, reviewUrl() ? { label: 'Leave a Google review', url: reviewUrl() } : null);
}
export async function sendReviewRequest(trip_id) {
  const t = tripDetail(trip_id);
  if (!getSetting('google_review_url')) throw Object.assign(new Error('Add your Google review link in Settings first.'), { status: 400 });
  const out = { email: null, sms: null };
  if (t.customer.email) out.email = await sendEmail(t.customer.email, 'Thanks for riding with us', reviewEmail(t.customer));
  if (t.customer.sms_optin && t.customer.phone) out.sms = await textCustomer(t.customer.id, reviewText(), 'review_request', { trip_id, force: true });
  run('UPDATE trips SET review_sent_at=? WHERE id=?', now(), trip_id);
  log('admin', 'review.requested', 'trip', trip_id);
  return out;
}

// ---------- signed calendar links ----------
import crypto from 'node:crypto';
export const icsKey = (id) => crypto.createHmac('sha256', getSetting('cal_token')).update(String(id)).digest('hex').slice(0, 16);
