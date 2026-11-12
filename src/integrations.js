// Outbound integrations: email (Brevo or Resend), texts (SimpleSender), Stripe (REST), all optional.
import crypto from 'node:crypto';
import { run, now, getSetting, all, one, insert, update } from './db.js';

export const env = (k, d = '') => process.env[k] ?? d;
export const BASE_URL = () => env('BASE_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, '');
export const status = () => ({
  stripe: !!env('STRIPE_SECRET_KEY'),
  stripe_webhook: !!env('STRIPE_WEBHOOK_SECRET'),
  email: !!(env('BREVO_API_KEY') || env('RESEND_API_KEY')),
  email_provider: env('BREVO_API_KEY') ? 'Brevo' : env('RESEND_API_KEY') ? 'Resend' : '',
  maps: !!env('GOOGLE_MAPS_API_KEY'),
  sms: !!(env('SMS_API_BASE') && env('SMS_API_KEY')),
  here: !!env('HERE_API_KEY'),
  chesky: !!env('CHESKY_API_KEY'),
});

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (c) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function emailShell(title, bodyHtml, cta) {
  const biz = esc(getSetting('business_name'));
  return `<!doctype html><html><body style="margin:0;background:#eef3f7;font-family:Arial,Helvetica,sans-serif;color:#10222f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="padding:20px 28px;border-bottom:4px solid #94bf33"><img src="${BASE_URL()}/img/logo.png" alt="${biz}" height="44"></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55"><h2 style="margin:0 0 14px;font-size:20px">${esc(title)}</h2>${bodyHtml}
${cta ? `<p style="margin:24px 0 6px"><a href="${cta.url}" style="background:#0078c0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;background:#10222f;color:#b8c7d3;font-size:12px">${biz} &middot; ${esc(getSetting('phone'))} &middot; ${esc(getSetting('email'))}</td></tr>
</table></td></tr></table></body></html>`;
}

function parseFrom(from) {
  const m = /^(.*)<(.+)>$/.exec(from.trim());
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { name: getSetting('business_name'), email: from.trim() };
}
/** attachments: [{ filename, content: Buffer, type }] */
export async function sendEmail(to, subject, html, { replyTo, attachments = [], kind } = {}) {
  if (!to) return { ok: false, error: 'no recipient' };
  const from = getSetting('email_from') || env('EMAIL_FROM') || `${getSetting('business_name')} <onboarding@resend.dev>`;
  const reply = replyTo || getSetting('email') || undefined;
  let st = 'logged', err = null;
  try {
    if (env('BREVO_API_KEY')) {
      const sender = parseFrom(env('EMAIL_FROM') || getSetting('email_from') || `${getSetting('business_name')} <${getSetting('email')}>`);
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, replyTo: reply ? { email: reply } : undefined, attachment: attachments.length ? attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') })) : undefined }),
      });
      if (r.ok) st = 'sent'; else { st = 'failed'; err = (await r.text()).slice(0, 300); }
    } else if (env('RESEND_API_KEY')) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, reply_to: reply, attachments: attachments.length ? attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) : undefined }),
      });
      if (r.ok) st = 'sent'; else { st = 'failed'; err = (await r.text()).slice(0, 300); }
    }
  } catch (e) { st = 'failed'; err = e.message; }
  run('INSERT INTO outbox(to_addr,subject,html,status,error,created_at,kind,from_addr,provider,attachments) VALUES(?,?,?,?,?,?,?,?,?,?)', to, subject, html, st, err, now(), kind || 'customer', from, env('BREVO_API_KEY') ? 'Brevo' : env('RESEND_API_KEY') ? 'Resend' : 'not sent (no provider)', attachments.map((a) => a.filename).join(', ') || null);
  return { ok: st !== 'failed', status: st, error: err };
}

// ---------- Text messages: SimpleSender REST API ----------
// POST {SMS_API_BASE}/v1/messages/send  { to: <10 digits>, message }  with a Bearer key.
// The account has one dedicated sending number, so there is no "from". A 2xx counts as accepted.
export const smsConfigured = () => !!(env('SMS_API_BASE') && env('SMS_API_KEY'));
const tenDigits = (p) => String(p || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
export async function smsRaw(to, body) {
  if (!smsConfigured()) return { ok: false, error: 'SMS not configured' };
  try {
    const r = await fetch(`${env('SMS_API_BASE').replace(/\/$/, '')}/v1/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${env('SMS_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: tenDigits(to), message: body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.status === 'failed' || j?.success === false || j?.error) return { ok: false, error: String(j?.error || j?.message || `SMS send failed (${r.status})`).slice(0, 200) };
    return { ok: true, id: j?.id != null ? String(j.id) : j?.message_id || null };
  } catch (e) { return { ok: false, error: e.message }; }
}
/** Send and record in the sent-messages log. meta: { kind, customer_id, trip_id } */
export async function sendSMS(to, body, meta = {}) {
  const id = insert('sms_log', { to_phone: to, body: String(body).slice(0, 1000), kind: meta.kind || 'manual', status: 'sending', customer_id: meta.customer_id || null, trip_id: meta.trip_id || null, direction: 'out', created_at: now() });
  const r = await smsRaw(to, body);
  update('sms_log', id, { status: r.ok ? 'sent' : 'failed', error: r.error || null, provider_id: r.id || null, sent_at: now() });
  return r;
}

// ---------- Admin notifications: each admin picks events, by email and/or text ----------
export const NOTIFY_EVENTS = [
  { key: 'new_lead', label: 'New quote request', email: true, sms: false },
  { key: 'quote_accepted', label: 'Quote accepted and signed', email: true, sms: false },
  { key: 'quote_declined', label: 'Quote declined', email: true, sms: false },
  { key: 'contract_signed', label: 'Agreement signed', email: true, sms: false },
  { key: 'payment', label: 'Payment received', email: true, sms: false },
  { key: 'hold', label: 'Card hold placed', email: true, sms: false },
  { key: 'payment_failed', label: 'Card payment failed', email: true, sms: false },
  { key: 'chargeback', label: 'Chargeback opened', email: true, sms: false },
  { key: 'insurance', label: 'Operator insurance expiring or expired', email: true, sms: false },
  { key: 'vendor_reply', label: 'Vendor replied to a price request', email: true, sms: false },
  { key: 'message', label: 'Contact form or quote question', email: true, sms: false },
  { key: 'chat', label: 'Website chat needs a person', email: true, sms: false },
  { key: 'sms_reply', label: 'Customer replied to a text', email: false, sms: false },
  { key: 'driver_status', label: 'Driver started, arrived or finished a trip', email: false, sms: false },
  { key: 'general', label: 'Other alerts', email: true, sms: false },
];
export function adminPrefs(u) {
  let saved = {}; try { saved = JSON.parse(u.notify_prefs || '{}'); } catch {}
  return Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, { email: saved[e.key]?.email ?? e.email, sms: saved[e.key]?.sms ?? e.sms }]));
}
export async function notifyOwner(subject, text, event = 'general') {
  const users = all('SELECT * FROM users');
  const sent = new Set();
  const html = emailShell(subject, `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, { label: 'Open admin', url: `${BASE_URL()}/admin` });
  for (const u of users) {
    const p = adminPrefs(u)[event] || adminPrefs(u).general;
    if (p.email && u.email) { sent.add(u.email.toLowerCase()); await sendEmail(u.email, subject, html, { kind: 'admin_alert' }); }
    if (p.sms && u.phone) await sendSMS(u.phone, `${subject}. ${String(text).replace(/\s+/g, ' ').slice(0, 220)} ${BASE_URL()}/admin`, { kind: 'admin_alert' });
  }
  const extra = getSetting('notify_email');
  if (extra && !sent.has(extra.toLowerCase())) await sendEmail(extra, subject, html, { kind: 'admin_alert' });
}

// ---------- Stripe (REST, no SDK) ----------
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out); else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}
async function stripe(path, body) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe is not configured (set STRIPE_SECRET_KEY).');
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Stripe error');
  return j;
}

export async function createCheckout({ invoice, amount_cents, email, auth = false, saveCard = false, stripeCustomer }) {
  const base = BASE_URL();
  return stripe('checkout/sessions', {
    mode: 'payment',
    ...(stripeCustomer ? { customer: stripeCustomer } : { customer_email: email || undefined }),
    success_url: `${base}/pay/${invoice.token}?paid=1`,
    cancel_url: `${base}/pay/${invoice.token}`,
    client_reference_id: String(invoice.id),
    metadata: { invoice_id: invoice.id, invoice_number: invoice.number, customer_id: invoice.customer_id, ...(auth ? { mode: 'auth' } : {}), ...(saveCard ? { save_card: '1' } : {}) },
    payment_intent_data: { ...(auth ? { capture_method: 'manual' } : {}), ...(saveCard ? { setup_future_usage: 'off_session' } : {}), metadata: { invoice_id: invoice.id, invoice_number: invoice.number, ...(auth ? { mode: 'auth' } : {}) }, description: `${getSetting('business_name')} invoice ${invoice.number}${auth ? ' (card hold)' : ''}` },
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: amount_cents, product_data: { name: auth ? `Card hold for invoice ${invoice.number}` : `Invoice ${invoice.number}`, description: auth ? 'Your card is authorized, not charged, until the trip is confirmed or completed.' : (invoice.title || 'Charter bus service') } } } },
  });
}

export const CARD_CONSENT = () => `I authorize ${getSetting('business_name')} to charge this card for the balance of my trip and for extras I agreed to, such as overtime and gratuity.`;
export async function stripeCustomerFor({ id, name, email, phone, stripe_customer_id }) {
  if (stripe_customer_id) return stripe_customer_id;
  const c = await stripe('customers', { name: name || undefined, email: email || undefined, phone: phone || undefined, metadata: { customer_id: id } });
  run('UPDATE customers SET stripe_customer_id=? WHERE id=?', c.id, id);
  return c.id;
}
/** Stripe-hosted page that saves a card without charging it. */
export async function createSetupCheckout({ customer_id, stripeCustomer }) {
  const base = BASE_URL();
  return stripe('checkout/sessions', { mode: 'setup', customer: stripeCustomer, currency: 'usd', payment_method_types: { 0: 'card' }, success_url: `${base}/pay?saved=1`, cancel_url: `${base}/pay`, metadata: { customer_id, save_card: '1' }, custom_text: { submit: { message: CARD_CONSENT() } } });
}
export const getSetupIntent = (id) => stripe(`setup_intents/${encodeURIComponent(id)}`);
export const getPaymentIntent = (id) => stripe(`payment_intents/${encodeURIComponent(id)}`);
export const getPaymentMethod = (id) => stripe(`payment_methods/${encodeURIComponent(id)}`);
export const detachPaymentMethod = (id) => stripe(`payment_methods/${encodeURIComponent(id)}/detach`, {});
/** Charge a saved card with the customer not present. Throws a plain message if the bank wants the customer to confirm. */
export async function chargeSaved({ customer, pm, amount_cents, invoice }) {
  try {
    return await stripe('payment_intents', { amount: amount_cents, currency: 'usd', customer, payment_method: pm, off_session: 'true', confirm: 'true', description: `${getSetting('business_name')} invoice ${invoice.number}`, metadata: { invoice_id: invoice.id, invoice_number: invoice.number, mode: 'saved_card' } });
  } catch (e) {
    if (/authentication|requires_action|authenticate/i.test(e.message)) throw new Error('The bank wants the customer to confirm this charge. Send them a payment link instead.');
    throw e;
  }
}
export async function capturePayment(payment_intent, amount_cents) { return stripe(`payment_intents/${encodeURIComponent(payment_intent)}/capture`, amount_cents ? { amount_to_capture: amount_cents } : {}); }
export async function cancelPayment(payment_intent) { return stripe(`payment_intents/${encodeURIComponent(payment_intent)}/cancel`, {}); }
export async function refundPayment(payment_intent, amount_cents) {
  return stripe('refunds', { payment_intent, amount: amount_cents });
}

/** Verify Stripe-Signature header against the raw request body. */
export function verifyStripe(raw, header, secret, tolerance = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = parts.t;
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ---------- Google Maps (Places API New + Routes), server-side so one key does it all ----------
const MAPS = () => env('GOOGLE_MAPS_API_KEY');
export async function placesAutocomplete(input, sessionToken) {
  if (!MAPS()) return [];
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': MAPS() },
    body: JSON.stringify({ input, sessionToken, languageCode: 'en', locationBias: { circle: { center: { latitude: 40.7128, longitude: -74.006 }, radius: 50000 } } }),
  });
  if (!r.ok) throw new Error('Places autocomplete failed');
  const j = await r.json();
  return (j.suggestions || []).filter((s) => s.placePrediction).slice(0, 6).map((s) => ({ place_id: s.placePrediction.placeId, text: s.placePrediction.text?.text, main: s.placePrediction.structuredFormat?.mainText?.text, secondary: s.placePrediction.structuredFormat?.secondaryText?.text }));
}
export async function placeDetails(placeId, sessionToken) {
  if (!MAPS()) throw new Error('Maps not configured');
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken || '')}`, { headers: { 'X-Goog-Api-Key': MAPS(), 'X-Goog-FieldMask': 'id,formattedAddress,location' } });
  if (!r.ok) throw new Error('Place lookup failed');
  const j = await r.json();
  return { place_id: j.id, address: j.formattedAddress, lat: j.location?.latitude, lng: j.location?.longitude };
}
/**
 * Drive distance and time through an ordered list of stops. Never prices anything.
 * Buses (coach, party bus, trolley, double decker) use HERE "privateBus" routing, which avoids roads closed to buses
 * (parkways, low bridges, weight limits) using the vehicle size from Settings. Limos, sprinters and cars use normal car routing.
 * Without a HERE key it falls back to Google, which is NOT bus aware, and says so.
 */
const hereCoord = async (s) => {
  if (s.lat && s.lng) return `${s.lat},${s.lng}`;
  const r = await fetch(`https://geocode.search.hereapi.com/v1/geocode?limit=1&q=${encodeURIComponent(s.address)}&apiKey=${env('HERE_API_KEY')}`);
  const j = r.ok ? await r.json() : null;
  const p = j?.items?.[0]?.position;
  if (!p) throw new Error(`Could not find "${s.address}" on the map. Pick it from the address suggestions.`);
  return `${p.lat},${p.lng}`;
};
export async function routeEstimate(stops, { bus = true, departAtUtc } = {}) {
  const pts = stops.filter((s) => s.address || (s.lat && s.lng));
  if (pts.length < 2) throw new Error('Add at least two stops first.');
  if (env('HERE_API_KEY')) {
    const co = [];
    for (const p of pts) co.push(await hereCoord(p));
    const run = async (mode) => {
      const q = new URLSearchParams({ transportMode: mode, origin: co[0], destination: co[co.length - 1], return: 'summary', apiKey: env('HERE_API_KEY') });
      co.slice(1, -1).forEach((c) => q.append('via', c));
      if (departAtUtc) q.set('departureTime', departAtUtc);
      if (mode === 'privateBus') {
        q.set('vehicle[height]', getSetting('bus_height_cm') || '370'); q.set('vehicle[width]', getSetting('bus_width_cm') || '260');
        q.set('vehicle[length]', getSetting('bus_length_cm') || '1370'); q.set('vehicle[grossWeight]', getSetting('bus_weight_kg') || '18000');
      }
      const r = await fetch(`https://router.hereapi.com/v8/routes?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.routes?.[0]) throw new Error(j.title || j.error_description || (mode === 'car' ? 'No car route found.' : 'No route found for a bus between these stops.'));
      const legs = j.routes[0].sections.map((sec, i) => ({ from: pts[i].address, to: pts[i + 1].address, miles: Math.round((sec.summary.length / 1609.344) * 10) / 10, minutes: Math.round(sec.summary.duration / 60) }));
      return { miles: Math.round(legs.reduce((a, l) => a + l.miles, 0) * 10) / 10, minutes: legs.reduce((a, l) => a + l.minutes, 0), legs };
    };
    if (!bus) { const c = await run('car'); return { provider: 'HERE', bus_aware: false, mode: 'car', ...c }; }
    // For a bus, also price out the same trip as a car so the dispatcher can see what the bus restrictions cost.
    const [b, c] = await Promise.all([run('privateBus'), run('car').catch(() => null)]);
    const out = { provider: 'HERE', bus_aware: true, mode: 'bus', ...b };
    if (c) out.car = { ...c, extra_minutes: b.minutes - c.minutes, extra_miles: Math.round((b.miles - c.miles) * 10) / 10 };
    return out;
  }
  if (!MAPS()) throw new Error('Routing is not configured. Add HERE_API_KEY (bus routing) or GOOGLE_MAPS_API_KEY.');
  const wp = (s) => (s.lat && s.lng ? { location: { latLng: { latitude: s.lat, longitude: s.lng } } } : { address: s.address });
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': MAPS(), 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration' },
    body: JSON.stringify({ origin: wp(pts[0]), destination: wp(pts[pts.length - 1]), intermediates: pts.slice(1, -1).map(wp), travelMode: 'DRIVE' }),
  });
  if (!r.ok) throw new Error('Route lookup failed');
  const rt = (await r.json()).routes?.[0];
  if (!rt) throw new Error('No route found');
  const sec = (d) => Number(String(d || '0s').replace('s', ''));
  const legs = (rt.legs || []).map((l, i) => ({ from: pts[i].address, to: pts[i + 1].address, miles: Math.round((l.distanceMeters / 1609.344) * 10) / 10, minutes: Math.round(sec(l.duration) / 60) }));
  return { provider: 'Google', bus_aware: false, mode: 'car', miles: Math.round((rt.distanceMeters / 1609.344) * 10) / 10, minutes: Math.round(sec(rt.duration) / 60), legs, warning: 'This route is for a car. It may use parkways or roads that buses are not allowed on. Add a HERE key for bus-safe routing.' };
}

// ---------- FMCSA (the data behind SAFER Web). Free key: mobile.fmcsa.dot.gov, QCMobile API. ----------
// Gives operating authority, out-of-service status, safety rating and whether liability insurance is on file and for how much.
// It does NOT give the policy expiry date, so expiry stays a manual entry taken from the certificate.
export const saferLinks = (dot) => ({
  snapshot: `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dot || '')}`,
  insurance: `https://li-public.fmcsa.dot.gov/LIVIEW/pkg_carrquery.prc_carrlist?n_dotno=${encodeURIComponent(dot || '')}&s_prefix=MC&n_docketno=&s_legalname=&s_dbaname=&s_state=`,
});
export async function fmcsaLookup(dot) {
  const key = env('FMCSA_WEBKEY');
  if (!key) throw new Error('FMCSA lookups are not set up. Add FMCSA_WEBKEY, or use the SAFER links and enter what you see by hand.');
  dot = String(dot || '').replace(/\D/g, '');
  if (!dot) throw new Error('Enter the operator\'s USDOT number first.');
  const r = await fetch(`https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(r.status === 403 ? 'FMCSA rejected the key.' : 'FMCSA could not be reached. Try again, or use the SAFER links.');
  const j = await r.json().catch(() => ({}));
  const c = j?.content?.carrier;
  if (!c) throw new Error('FMCSA has no carrier with that USDOT number.');
  const yes = (v) => String(v || '').toUpperCase().startsWith('Y');
  const s = {
    name: c.legalName || c.dbaName || '', dba: c.dbaName || '', dot, allowed: yes(c.allowedToOperate), status: c.statusCode || '',
    common_authority: c.commonAuthorityStatus || '', contract_authority: c.contractAuthorityStatus || '', broker_authority: c.brokerAuthorityStatus || '',
    // FMCSA reports these in thousands of dollars (5000 means $5,000,000, the minimum for a bus carrying 16 or more).
    bipd_required: (Number(c.bipdRequiredAmount) || 0) * 1000, bipd_on_file: (Number(c.bipdInsuranceOnFile) || 0) * 1000,
    safety_rating: c.safetyRating || '', safety_rating_date: c.safetyRatingDate || '', oos_date: c.oosDate || '', power_units: c.totalPowerUnits ?? null, drivers: c.totalDrivers ?? null,
  };
  s.problems = [];
  if (!s.allowed) s.problems.push('FMCSA does not show this carrier as allowed to operate.');
  if (s.oos_date) s.problems.push(`Out of service order dated ${s.oos_date}.`);
  if (s.bipd_required && s.bipd_on_file < s.bipd_required) s.problems.push(`Liability insurance on file ($${s.bipd_on_file.toLocaleString()}) is below the required $${s.bipd_required.toLocaleString()}.`);
  if (/unsatisfactory/i.test(s.safety_rating)) s.problems.push('Safety rating is Unsatisfactory.');
  return s;
}
