// Outbound integrations: email (Resend), SMS (Twilio), Stripe (REST), all optional.
import crypto from 'node:crypto';
import { run, now, getSetting } from './db.js';

export const env = (k, d = '') => process.env[k] ?? d;
export const BASE_URL = () => env('BASE_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, '');
export const status = () => ({
  stripe: !!env('STRIPE_SECRET_KEY'),
  stripe_webhook: !!env('STRIPE_WEBHOOK_SECRET'),
  email: !!(env('BREVO_API_KEY') || env('RESEND_API_KEY')),
  email_provider: env('BREVO_API_KEY') ? 'Brevo' : env('RESEND_API_KEY') ? 'Resend' : '',
  maps: !!env('GOOGLE_MAPS_API_KEY'),
  sms: !!(env('TWILIO_SID') && env('TWILIO_TOKEN') && env('TWILIO_FROM')),
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
export async function sendEmail(to, subject, html, { replyTo, attachments = [] } = {}) {
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
  run('INSERT INTO outbox(to_addr,subject,html,status,error,created_at) VALUES(?,?,?,?,?,?)', to, subject, html, st, err, now());
  return { ok: st !== 'failed', status: st, error: err };
}

export async function sendSMS(to, body) {
  if (!status().sms) return { ok: false, error: 'SMS not configured' };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env('TWILIO_SID')}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${env('TWILIO_SID')}:${env('TWILIO_TOKEN')}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Body: body }),
  });
  return r.ok ? { ok: true } : { ok: false, error: (await r.text()).slice(0, 200) };
}

export async function notifyOwner(subject, text) {
  const to = getSetting('notify_email') || getSetting('email');
  return sendEmail(to, subject, emailShell(subject, `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, { label: 'Open admin', url: `${BASE_URL()}/admin` }));
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

export async function createCheckout({ invoice, amount_cents, email, auth = false }) {
  const base = BASE_URL();
  return stripe('checkout/sessions', {
    mode: 'payment',
    customer_email: email || undefined,
    success_url: `${base}/pay/${invoice.token}?paid=1`,
    cancel_url: `${base}/pay/${invoice.token}`,
    client_reference_id: String(invoice.id),
    metadata: { invoice_id: invoice.id, invoice_number: invoice.number, ...(auth ? { mode: 'auth' } : {}) },
    payment_intent_data: { ...(auth ? { capture_method: 'manual' } : {}), metadata: { invoice_id: invoice.id, invoice_number: invoice.number, ...(auth ? { mode: 'auth' } : {}) }, description: `${getSetting('business_name')} invoice ${invoice.number}${auth ? ' (card hold)' : ''}` },
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: amount_cents, product_data: { name: auth ? `Card hold for invoice ${invoice.number}` : `Invoice ${invoice.number}`, description: auth ? 'Your card is authorized, not charged, until the trip is confirmed or completed.' : (invoice.title || 'Charter bus service') } } } },
  });
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

// ---------- Google Maps (Places API New + Routes) — server-side so one key does it all ----------
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
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken || '')}`, { headers: { 'X-Goog-Api-Key': MAPS(), 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' } });
  if (!r.ok) throw new Error('Place lookup failed');
  const j = await r.json();
  return { place_id: j.id, name: j.displayName?.text, address: j.formattedAddress, lat: j.location?.latitude, lng: j.location?.longitude };
}
/** Driving distance/time through an ordered list of stops (to help staff price manually — never prices anything itself). */
export async function routeEstimate(stops) {
  if (!MAPS()) throw new Error('Google Maps is not configured');
  const pts = stops.filter((s) => s.address || (s.lat && s.lng));
  if (pts.length < 2) throw new Error('Need at least two stops');
  const wp = (s) => (s.lat && s.lng ? { location: { latLng: { latitude: s.lat, longitude: s.lng } } } : { address: s.address });
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': MAPS(), 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration' },
    body: JSON.stringify({ origin: wp(pts[0]), destination: wp(pts[pts.length - 1]), intermediates: pts.slice(1, -1).map(wp), travelMode: 'DRIVE' }),
  });
  if (!r.ok) throw new Error('Route lookup failed');
  const j = await r.json();
  const rt = j.routes?.[0];
  if (!rt) throw new Error('No route found');
  const secs = (d) => Number(String(d || '0s').replace('s', ''));
  return { miles: Math.round((rt.distanceMeters / 1609.344) * 10) / 10, minutes: Math.round(secs(rt.duration) / 60), legs: (rt.legs || []).map((l) => ({ miles: Math.round((l.distanceMeters / 1609.344) * 10) / 10, minutes: Math.round(secs(l.duration) / 60) })) };
}
