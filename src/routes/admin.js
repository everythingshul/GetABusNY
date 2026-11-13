import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, one, run, insert, update, now, token, nextNumber, randomRef, nextSeq, allSettings, setSetting, DEFAULT_SETTINGS, log, parse, totals, getSetting as getSettingSafe } from '../db.js';
import { BASE_URL as integ_base } from '../integrations.js';
import { requireAdmin, checkPassword, hashPassword, makeSession, limit } from '../auth.js';
import * as S from '../services.js';
import { emailSender as emailSenderOf, status as integ, sendEmail, emailShell, esc, refundPayment, money, createCheckout, capturePayment, cancelPayment } from '../integrations.js';
import { chatAdminRouter } from '../chesky.js';
import { listTexts, saveTexts, PAGE_LABELS } from '../content.js';
import { bannerAdminRouter } from '../banner.js';
import { chargeInvoice, removeCard, cardOf } from '../cards.js';
import { stripeCustomerFor, createSetupCheckout } from '../integrations.js';
import { normItinerary, summarize, billableLines, mapsDirUrl, planTimes, isBusCategory } from '../itinerary.js';
import { createContract, sendContract, contractPdfPath, exportWorkbook, EXPORT_KINDS, trafficReport, contractView } from '../extras.js';
import { XLSX_TYPE } from '../xlsx.js';
import { routeEstimate, NOTIFY_EVENTS, adminPrefs, fmcsaLookup, saferLinks, sendSMS, smsConfigured } from '../integrations.js';

export const admin = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { if (e.status) res.status(e.status).json({ error: e.message }); else { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); } } };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

// ---------- auth ----------
admin.post('/login', limit('login', 10, 900000), (req, res) => {
  const u = one('SELECT * FROM users WHERE lower(email)=?', String(req.body?.email || '').toLowerCase());
  if (!u || !checkPassword(String(req.body?.password || ''), u.pass_hash)) return res.status(401).json({ error: 'Wrong email or password' });
  res.setHeader('Set-Cookie', `gab_admin=${makeSession(u.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
admin.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'gab_admin=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
admin.use(requireAdmin);
admin.get('/me', (req, res) => res.json({ user: req.user, integrations: integ() }));
admin.post('/password', wrap((req) => {
  const u = one('SELECT * FROM users WHERE id=?', req.user.id);
  if (!checkPassword(String(req.body.current || ''), u.pass_hash)) throw bad('Current password is wrong');
  if (String(req.body.next || '').length < 10) throw bad('New password must be at least 10 characters');
  update('users', u.id, { pass_hash: hashPassword(req.body.next) });
  return { ok: true };
}));
admin.get('/users', wrap(() => all('SELECT id,email,name,phone,role,created_at FROM users')));
admin.post('/users', wrap((req) => {
  const { email, name, password } = req.body || {};
  if (!email || String(password || '').length < 10) throw bad('Email and a 10+ character password are required');
  return { id: insert('users', { email: email.toLowerCase(), name, pass_hash: hashPassword(password), role: 'admin', created_at: now() }) };
}));
admin.delete('/users/:id', wrap((req) => { if (Number(req.params.id) === req.user.id) throw bad("You can't delete yourself"); run('DELETE FROM users WHERE id=?', req.params.id); return { ok: true }; }));

// ---------- dashboards ----------
admin.get('/dashboard', wrap(() => S.dashboard()));
admin.get('/analytics', wrap((req) => S.analytics(Number(req.query.months) || 12)));
admin.get('/activity', wrap(() => all('SELECT * FROM activity ORDER BY id DESC LIMIT 200')));
admin.get('/outbox', wrap(() => all('SELECT id,to_addr,subject,status,error,created_at FROM outbox ORDER BY id DESC LIMIT 100')));

// ---------- settings ----------
admin.get('/settings', wrap(() => { const s = allSettings(); return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, s[k] ?? DEFAULT_SETTINGS[k]])); }));
admin.put('/settings', wrap((req) => { for (const [k, v] of Object.entries(req.body || {})) if (k in DEFAULT_SETTINGS) setSetting(k, typeof v === 'object' ? JSON.stringify(v) : v); log(req.user.email, 'settings.updated', 'settings', null); return { ok: true }; }));

// ---------- image upload ----------
const UP = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
admin.post('/upload', express.raw({ type: 'image/*', limit: '8mb' }), wrap((req) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || b.length < 16) throw bad('No image received');
  const ext = b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : b.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ? 'jpg' : b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : b.subarray(0, 3).toString() === 'GIF' ? 'gif' : null;
  if (!ext) throw bad('Only PNG, JPG, WEBP or GIF images are allowed');
  fs.mkdirSync(UP, { recursive: true });
  const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UP, name), b);
  return { url: `/uploads/${name}` };
}));

// ---------- generic CRUD ----------
const J = (...f) => f; // readability
const RES = {
  customers: { fields: J('name', 'email', 'phone', 'company', 'address', 'notes', 'tags', 'sms_optin', 'sms_stop'), before: (o) => { if ('sms_stop' in o) { o.sms_stop_at = o.sms_stop ? now() : null; if (o.sms_stop) o.sms_optin = 0; delete o.sms_stop; } return o; }, sel: 'SELECT t.*, (SELECT COUNT(*) FROM trips x WHERE x.customer_id=t.id) trip_count FROM customers t', search: ['t.name', 't.email', 't.phone', 't.company'], order: 't.name COLLATE NOCASE', del: (id) => !one('SELECT 1 x FROM trips WHERE customer_id=? UNION SELECT 1 FROM invoices WHERE customer_id=?', id, id) },
  vehicles: { fields: J('name', 'category', 'capacity', 'description', 'features', 'image', 'images', 'operator_url', 'internal_pricing', 'internal_notes', 'hourly_cents', 'min_hours', 'active', 'sort'), before: (o) => { if ('operator_url' in o) { const u = String(o.operator_url || '').trim(); o.operator_url = /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : null; } if ('images' in o) { let a = o.images; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = []; } } a = [...new Set((Array.isArray(a) ? a : []).map(String).filter((u) => /^(\/uploads\/[\w.-]+|https?:\/\/[^\s"<>]+)$/.test(u)))].slice(0, 15); o.images = JSON.stringify(a); o.image = a[0] || null; } return o; }, sel: 'SELECT t.* FROM vehicles t', search: ['t.name', 't.category'], order: 't.sort, t.name', del: () => true },
  drivers: { fields: J('name', 'phone', 'email', 'vendor_id', 'active', 'notes'), sel: 'SELECT t.*, v.name vendor_name FROM drivers t LEFT JOIN vendors v ON v.id=t.vendor_id', search: ['t.name', 't.phone'], order: 't.name COLLATE NOCASE', del: () => true, create: (o) => ({ ...o, token: token(24) }), extra: (r) => ({ ...r, portal_url: `${process.env.BASE_URL || ''}/d/${r.token}` }) },
  vendors: { fields: J('name', 'contact_name', 'email', 'phone', 'vehicle_types', 'service_area', 'rating', 'notes', 'active', 'insurance_carrier', 'insurance_policy', 'insurance_expires', 'dot_number', 'mc_number'), sel: 'SELECT t.* FROM vendors t', search: ['t.name', 't.contact_name', 't.email', 't.service_area'], order: 't.name COLLATE NOCASE', del: (id) => !one('SELECT 1 x FROM trips WHERE vendor_id=?', id) },
  requests: { fields: J('name', 'email', 'phone', 'status', 'notes', 'referred_by', 'details'), sel: 'SELECT t.*, c.name customer_name FROM requests t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.name', 't.email', 't.ref', 't.phone'], order: 't.id DESC', del: () => true },
  quotes: { fields: J('customer_id', 'title', 'items', 'tax_rate', 'deposit_pct', 'valid_until', 'notes', 'trip', 'status'), sel: 'SELECT t.*, c.name customer_name FROM quotes t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.number', 't.title', 'c.name'], order: 't.id DESC', del: (id) => one('SELECT status FROM quotes WHERE id=?', id)?.status === 'draft', create: (o) => ({ number: randomRef('Q', 'quotes', 'number'), seq: nextSeq('quotes'), token: token(), status: 'draft', ...o }), before: (o) => { if (o.trip && typeof o.trip === 'object') { o.trip.itinerary = normItinerary(o.trip.itinerary); const f = summarize(o.trip.itinerary); for (const k of ['pickup', 'dropoff', 'stops']) o.trip[k] = f[k]; for (const k of ['depart_at', 'return_at']) if (!o.trip[k] && f[k]) o.trip[k] = f[k]; } return o; }, after: (id) => S.recalcQuote(id) },
  trips: { fields: J('customer_id', 'status', 'title', 'purpose', 'itinerary', 'pickup', 'dropoff', 'stops', 'depart_at', 'return_at', 'passengers', 'vehicle_id', 'vendor_id', 'vendor_cost_cents', 'driver_id', 'price_cents', 'onsite_name', 'onsite_phone', 'notes', 'driver_notes'), before: (o) => { if ('itinerary' in o) { o.itinerary = normItinerary(typeof o.itinerary === 'string' ? JSON.parse(o.itinerary || '[]') : o.itinerary); const f = summarize(o.itinerary); for (const k of ['pickup', 'dropoff', 'stops']) o[k] = f[k]; for (const k of ['depart_at', 'return_at']) if (!o[k] && f[k]) o[k] = f[k]; } return o; }, sel: 'SELECT t.*, c.name customer_name, v.name vehicle_name, d.name driver_name, vn.name vendor_name FROM trips t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN vendors vn ON vn.id=t.vendor_id', search: ['t.ref', 't.title', 'c.name', 't.pickup', 't.dropoff'], order: 't.depart_at DESC', del: () => false, create: (o) => ({ ref: nextNumber('TRIP'), status: 'booked', ...o }), after: (id, created) => { if (created) S.scheduleTripFollowups(id); } },
  invoices: { fields: J('customer_id', 'trip_id', 'status', 'title', 'items', 'tax_rate', 'deposit_cents', 'gratuity_cents', 'due_date', 'notes'), sel: 'SELECT t.*, c.name customer_name FROM invoices t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.number', 't.title', 'c.name'], order: 't.id DESC', del: (id) => one('SELECT status FROM invoices WHERE id=?', id)?.status === 'draft', create: (o) => ({ number: nextNumber('INV'), token: token(), status: 'draft', ...o }), after: (id) => S.recalcInvoice(id) },
  followups: { fields: J('entity_type', 'entity_id', 'kind', 'channel', 'to_email', 'subject', 'body', 'due_at', 'status'), sel: 'SELECT t.* FROM followups t', search: ['t.subject', 't.kind'], order: "CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.due_at", del: () => true, create: (o) => ({ auto: 0, channel: 'task', kind: 'manual', status: 'pending', ...o }) },
  messages: { fields: J('status'), sel: 'SELECT t.* FROM messages t', search: ['t.name', 't.email', 't.subject', 't.body'], order: 't.id DESC', del: () => true },
};
const money_fields = [];
const tidy = (table, o) => { // normalise empties so integer/id columns store NULL
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = v === '' ? null : v;
  return out;
};

for (const [name, cfg] of Object.entries(RES)) {
  const table = cfg.sel.match(/FROM (\w+) t/)[1];
  admin.get(`/${name}`, wrap((req) => {
    const where = [], args = [];
    if (req.query.q) { where.push('(' + cfg.search.map((c) => `${c} LIKE ?`).join(' OR ') + ')'); cfg.search.forEach(() => args.push(`%${req.query.q}%`)); }
    for (const f of ['status', 'customer_id', 'driver_id', 'vendor_id', 'category']) if (req.query[f] && cfg.sel.includes(`${table}`) && (cfg.fields.includes(f) || f === 'status')) { where.push(`t.${f}=?`); args.push(req.query[f]); }
    if (name === 'trips' && req.query.from) { where.push('substr(t.depart_at,1,10)>=?'); args.push(req.query.from); }
    if (name === 'trips' && req.query.to) { where.push('substr(t.depart_at,1,10)<=?'); args.push(req.query.to); }
    if (name === 'followups' && req.query.due) { where.push("t.status='pending' AND t.due_at<=?"); args.push(now()); }
    const rows = all(`${cfg.sel} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${cfg.order} LIMIT ${Math.min(Number(req.query.limit) || 300, 1000)}`, ...args);
    return cfg.extra ? rows.map(cfg.extra) : rows;
  }));
  admin.get(`/${name}/:id`, wrap((req) => {
    const r = one(`${cfg.sel} WHERE t.id=?`, req.params.id);
    if (!r) throw bad('Not found', 404);
    return cfg.extra ? cfg.extra(r) : r;
  }));
  const pick = (body) => { const o = {}; for (const f of cfg.fields) if (f in body) o[f] = body[f]; return tidy(table, o); };
  admin.post(`/${name}`, wrap((req) => {
    let o = pick(req.body || {});
    if (cfg.before) o = cfg.before(o);
    if (name === 'customers' && o.sms_optin) { o.sms_optin_at = now(); }
    if (name === 'quotes' && !o.items) o.items = [];
    if (cfg.create) o = cfg.create(o);
    const stamp = ['customers', 'vehicles', 'drivers', 'vendors', 'quotes', 'trips', 'invoices', 'requests'].includes(name) ? { created_at: now(), updated_at: now() } : name === 'followups' ? { created_at: now() } : {};
    if (name === 'followups' && !o.due_at) o.due_at = now();
    const id = insert(table, { ...o, ...stamp });
    cfg.after?.(id, true);
    log(req.user.email, `${name}.created`, name, id);
    return one(`${cfg.sel} WHERE t.id=?`, id);
  }));
  admin.put(`/${name}/:id`, wrap((req) => {
    const id = Number(req.params.id);
    if (!one(`SELECT 1 x FROM ${table} WHERE id=?`, id)) throw bad('Not found', 404);
    let o = pick(req.body || {});
    if (cfg.before) o = cfg.before(o);
    const prev = name === 'quotes' ? one('SELECT * FROM quotes WHERE id=?', id) : null;
    if (prev && prev.status === 'accepted') throw bad('This quote was accepted and signed, so it is locked. Change the trip or add an invoice instead.', 409);
    if (name === 'customers' && o.sms_optin) o.sms_optin_at = now();
    if (name === 'invoices' && o.status === 'sent') delete o.status; // use the Send action
    update(table, id, { ...o, ...(table !== 'followups' && table !== 'messages' ? { updated_at: now() } : {}) });
    if (name === 'followups' && o.status && o.status !== 'pending') update('followups', id, { done_at: now() });
    if (name === 'trips' && o.status === 'cancelled') log(req.user.email, 'trip.cancelled', 'trip', id);
    cfg.after?.(id, false);
    if (prev && ['sent', 'declined', 'expired'].includes(prev.status)) S.recordQuoteRevision(prev, one('SELECT * FROM quotes WHERE id=?', id), { by: req.user.email, reason: String(req.body?.revision_note || '').slice(0, 300) });
    return one(`${cfg.sel} WHERE t.id=?`, id);
  }));
  admin.delete(`/${name}/:id`, wrap((req) => {
    if (!cfg.del(req.params.id)) throw bad('This record has related history and cannot be deleted. Mark it inactive/cancelled/void instead.');
    run(`DELETE FROM ${table} WHERE id=?`, req.params.id);
    log(req.user.email, `${name}.deleted`, name, Number(req.params.id));
    return { ok: true };
  }));
}

// ---------- customer history ----------
admin.get('/customers/:id/history', wrap((req) => ({
  requests: all('SELECT id,ref,status,created_at,details FROM requests WHERE customer_id=? ORDER BY id DESC', req.params.id),
  quotes: all('SELECT id,number,status,total_cents,created_at FROM quotes WHERE customer_id=? ORDER BY id DESC', req.params.id),
  trips: all('SELECT id,ref,status,title,depart_at,price_cents FROM trips WHERE customer_id=? ORDER BY depart_at DESC', req.params.id),
  invoices: all('SELECT id,number,status,total_cents,amount_paid_cents,due_date FROM invoices WHERE customer_id=? ORDER BY id DESC', req.params.id),
})));

// ---------- actions ----------
admin.post('/requests/manual', wrap((req) => S.createRequest(req.body || {}, 'admin')));
admin.post('/requests/:id/quote', wrap((req) => ({ quote_id: S.quoteFromRequest(Number(req.params.id)) })));
admin.post('/quotes/:id/send', wrap(async (req) => { S.recalcQuote(req.params.id); const r = await S.sendQuote(Number(req.params.id), req.user.email, { skip_email: !!req.body?.skip_email, skip_sms: !!req.body?.skip_sms }); return { ok: true, email: r }; }));
admin.post('/quotes/:id/accept', wrap((req) => S.acceptQuote(Number(req.params.id), req.user.email)));
admin.post('/quotes/:id/duplicate', wrap((req) => {
  const q = one('SELECT * FROM quotes WHERE id=?', req.params.id);
  const { id, number, token: _t, sent_at, viewed_at, accepted_at, declined_at, ...rest } = q;
  const nid = insert('quotes', { ...rest, number: randomRef('Q', 'quotes', 'number'), seq: nextSeq('quotes'), token: token(), status: 'draft', created_at: now(), updated_at: now() });
  return { id: nid };
}));
admin.get('/quotes/:id/link', wrap((req) => ({ url: S.link.quote(one('SELECT token FROM quotes WHERE id=?', req.params.id)) })));

admin.post('/invoices/:id/send', wrap(async (req) => ({ ok: true, email: await S.sendInvoice(Number(req.params.id), req.user.email, { skip_email: !!req.body?.skip_email }) })));
admin.get('/invoices/:id/link', wrap((req) => ({ url: S.link.pay(one('SELECT token FROM invoices WHERE id=?', req.params.id)) })));
admin.get('/invoices/:id/payments', wrap((req) => all('SELECT * FROM payments WHERE invoice_id=? ORDER BY id', req.params.id)));
admin.post('/invoices/:id/payments', wrap((req) => {
  const amt = Math.round(Number(req.body.amount_cents));
  if (!Number.isFinite(amt) || amt <= 0) throw bad('Enter a payment amount');
  const inv = one('SELECT status FROM invoices WHERE id=?', req.params.id);
  if (inv?.status === 'void') throw bad('Invoice is void');
  return { id: S.recordPayment(Number(req.params.id), { amount_cents: amt, method: req.body.method || 'cash', reference: req.body.reference, note: req.body.note, skip_email: !!req.body.skip_email, skip_sms: !!req.body.skip_sms }, req.user.email) };
}));
admin.post('/payments/:id/refund', wrap(async (req) => {
  const p = one('SELECT * FROM payments WHERE id=?', req.params.id);
  if (!p || p.amount_cents <= 0) throw bad('Payment not found');
  if (p.status !== 'succeeded') throw bad('Only completed payments can be refunded. Release a hold instead.');
  const done = -one("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE method='refund' AND stripe_pi IS ? AND invoice_id=?", p.stripe_pi, p.invoice_id).s;
  const left = p.amount_cents - done;
  const amt = Math.round(Number(req.body.amount_cents)) || left;
  if (amt <= 0 || amt > left) throw bad(`You can refund up to ${money(left)} on this payment.`);
  let ref = null;
  if (p.method === 'card' && p.stripe_pi) { const r = await refundPayment(p.stripe_pi, amt); ref = r.id; }
  insert('payments', { invoice_id: p.invoice_id, amount_cents: -amt, method: 'refund', reference: ref || req.body.reference, stripe_session: ref, stripe_pi: p.stripe_pi, status: 'succeeded', note: req.body.note, created_at: now() });
  S.recalcInvoice(p.invoice_id);
  log(req.user.email, 'payment.refunded', 'invoice', p.invoice_id, money(amt));
  return { ok: true };
}));
admin.get('/payments', wrap(() => all('SELECT p.*, i.number invoice_number, c.name customer_name FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id ORDER BY p.id DESC LIMIT 300')));

admin.get('/trips/:id/detail', wrap((req) => ({ ...S.tripDetail(Number(req.params.id)), events: all('SELECT * FROM trip_events WHERE trip_id=? ORDER BY id DESC', req.params.id), rfqs: all('SELECT r.*, v.name vendor_name FROM rfqs r JOIN vendors v ON v.id=r.vendor_id WHERE r.trip_id=?', req.params.id), invoices: all('SELECT id,number,status,total_cents,amount_paid_cents FROM invoices WHERE trip_id=?', req.params.id), contracts: all('SELECT id,number,status,signer_name,signed_at,total_cents FROM contracts WHERE trip_id=? ORDER BY id DESC', req.params.id), maps_url: mapsDirUrl(normItinerary(parse(one('SELECT itinerary FROM trips WHERE id=?', req.params.id)?.itinerary, []))) })));
admin.post('/trips/:id/confirm-email', wrap(async (req) => ({ ok: true, email: await S.sendTripConfirmation(Number(req.params.id)) })));
admin.post('/trips/:id/invoice', wrap((req) => {
  const t = one('SELECT * FROM trips WHERE id=?', req.params.id);
  const items = [{ desc: t.title || 'Charter service', qty: 1, unit_cents: t.price_cents || 0 }];
  const id = insert('invoices', { number: randomRef('INV', 'invoices', 'number'), seq: nextSeq('invoices'), token: token(), customer_id: t.customer_id, trip_id: t.id, status: 'draft', title: t.title, items, tax_rate: Number(allSettings().tax_rate) || 0, ...totals(items, Number(allSettings().tax_rate) || 0), due_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), created_at: now(), updated_at: now() });
  return { id };
}));

admin.post('/drivers/:id/send-link', wrap(async (req) => ({ ok: true, result: await S.sendDriverLink(Number(req.params.id), req.body?.via === 'sms' ? 'sms' : 'email') })));
admin.post('/drivers/:id/regenerate', wrap((req) => { update('drivers', req.params.id, { token: token(24) }); return { ok: true }; }));

// vendors / RFQs
admin.get('/rfqs', wrap((req) => all(`SELECT r.*, v.name vendor_name, v.phone vendor_phone, rq.ref request_ref, t.ref trip_ref FROM rfqs r JOIN vendors v ON v.id=r.vendor_id LEFT JOIN requests rq ON rq.id=r.request_id LEFT JOIN trips t ON t.id=r.trip_id ${req.query.status ? 'WHERE r.status=?' : ''} ORDER BY r.id DESC LIMIT 300`, ...(req.query.status ? [req.query.status] : []))));
admin.post('/rfqs', wrap(async (req) => {
  const { request_id, trip_id, vendor_ids, message } = req.body || {};
  if (!(request_id || trip_id) || !Array.isArray(vendor_ids) || !vendor_ids.length) throw bad('Choose a trip/request and at least one vendor');
  return { sent: await S.sendRFQs({ request_id, trip_id, vendor_ids, message }) };
}));
// Operators answer by email or phone. Staff record what they said; there is no operator portal.
admin.post('/rfqs/:id/reply', wrap((req) => {
  const r = one('SELECT * FROM rfqs WHERE id=?', req.params.id); if (!r) throw bad('Not found', 404);
  if (['accepted', 'closed'].includes(r.status)) throw bad('This request was already awarded or closed.');
  const b = req.body || {};
  if (b.declined) update('rfqs', r.id, { status: 'declined', responded_at: now(), response_notes: String(b.notes || '').slice(0, 1000) });
  else {
    const price = Math.round(Number(b.price) * 100);
    if (!Number.isFinite(price) || price <= 0) throw bad('Enter their price.');
    update('rfqs', r.id, { status: 'responded', price_cents: price, offered_vehicle: String(b.vehicle || '').slice(0, 200), response_notes: String(b.notes || '').slice(0, 1000), responded_at: now() });
  }
  log(req.user.email, b.declined ? 'rfq.declined' : 'rfq.reply_recorded', 'rfq', r.id);
  return { ok: true };
}));
admin.post('/rfqs/:id/accept', wrap(async (req) => { await S.acceptRFQ(Number(req.params.id)); return { ok: true }; }));
admin.post('/rfqs/:id/close', wrap((req) => { update('rfqs', req.params.id, { status: 'closed' }); return { ok: true }; }));

// follow-ups
admin.post('/followups/run', wrap(async () => ({ sent: await S.runFollowups() })));
admin.post('/followups/send', wrap(async (req) => {
  const { to, subject, body, entity_type, entity_id } = req.body || {};
  if (!to || !subject || !body) throw bad('Recipient, subject and message are required');
  const r = await sendEmail(to, subject, emailShell(subject, `<p>${esc(body).replace(/\n/g, '<br>')}</p>`));
  insert('followups', { entity_type: entity_type || 'general', entity_id: entity_id || null, kind: 'manual_email', channel: 'email', to_email: to, subject, body, due_at: now(), status: r.ok ? 'sent' : 'failed', auto: 0, result: r.error || r.status, created_at: now(), done_at: now() });
  return r;
}));

admin.use('/banner', bannerAdminRouter());
// Chesky (admin): handoff inbox, teach, assistant
admin.use('/chesky', chatAdminRouter());

// ---------- itinerary helpers (pricing is always entered by hand) ----------
admin.post('/itinerary/lines', wrap((req) => billableLines(normItinerary(req.body?.itinerary), { purpose: req.body?.purpose })));
admin.post('/route-estimate', wrap(async (req) => {
  const it = normItinerary(req.body?.itinerary);
  const cat = req.body?.vehicle_id ? one('SELECT category FROM vehicles WHERE id=?', req.body.vehicle_id)?.category : null;
  const bus = isBusCategory(cat);
  const first = it.find((x) => x.time);
  const r = await routeEstimate(it, { bus, departAtUtc: first ? S.localToDate(first.time).toISOString() : undefined });
  return { ...r, vehicle_category: cat || null, stops: planTimes(it, r.legs), car_stops: r.car ? planTimes(it, r.car.legs) : null };
}));

// ---------- contracts / e-signature ----------
admin.get('/contracts', wrap(() => all("SELECT k.id,k.number,k.status,k.total_cents,k.signer_name,k.signed_at,k.sent_at,k.created_at,k.trip_id,c.name customer_name, t.ref trip_ref FROM contracts k LEFT JOIN customers c ON c.id=k.customer_id LEFT JOIN trips t ON t.id=k.trip_id ORDER BY k.id DESC LIMIT 300")));
admin.post('/contracts', wrap((req) => { const k = createContract({ quote_id: req.body?.quote_id, trip_id: req.body?.trip_id }); log(req.user.email, 'contract.created', 'contract', k.id); return { id: k.id }; }));
admin.post('/contracts/:id/send', wrap(async (req) => ({ ok: true, email: await sendContract(Number(req.params.id)) })));
admin.get('/contracts/:id/link', wrap((req) => ({ url: `${integ_base()}/contract/${one('SELECT token FROM contracts WHERE id=?', req.params.id)?.token}` })));
admin.post('/contracts/:id/void', wrap((req) => { update('contracts', req.params.id, { status: 'void' }); return { ok: true }; }));
admin.get('/contracts/:id/pdf', (req, res) => {
  const k = one('SELECT * FROM contracts WHERE id=?', req.params.id); const f = k && contractPdfPath(k);
  if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'Not signed yet' });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${k.number}.pdf"`); res.send(fs.readFileSync(f));
});

// ---------- texts & reviews ----------
admin.post('/trips/:id/review-request', wrap(async (req) => ({ ok: true, ...(await S.sendReviewRequest(Number(req.params.id))) })));
admin.post('/customers/:id/text', wrap(async (req) => {
  const body = String(req.body?.message || '').trim().slice(0, 500); if (!body) throw bad('Write a message');
  const r = await S.textCustomer(Number(req.params.id), body, 'manual', { trip_id: req.body?.trip_id, force: true });
  if (!r.ok) throw bad(r.error); log(req.user.email, 'sms.sent', 'customer', Number(req.params.id), body); return r;
}));
// Write a text from the Messages page: to a customer, or to any number (replies, operators, drivers).
admin.post('/messages/text', wrap(async (req) => {
  const message = String(req.body?.message || '').trim().slice(0, 600); if (!message) throw bad('Write a message');
  if (!smsConfigured()) throw bad('Texts are not set up yet. Add SMS_API_BASE and SMS_API_KEY on the server.');
  const cid = Number(req.body?.customer_id) || null;
  if (cid) { const r = await S.textCustomer(cid, message, 'manual', { force: true }); if (!r.ok) throw bad(r.error); log(req.user.email, 'sms.sent', 'customer', cid, message); return { ok: true }; }
  const ten = String(req.body?.to || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
  if (ten.length !== 10) throw bad('Enter a 10 digit phone number, or pick a customer.');
  const cust = one("SELECT id, name, sms_stop_at FROM customers WHERE replace(replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')',''),'+','') LIKE ?", `%${ten}`);
  if (cust?.sms_stop_at) throw bad(`${cust.name} replied STOP, so no texts can be sent to this number.`);
  const r = await sendSMS(ten, message, { kind: 'manual', customer_id: cust?.id || null });
  if (!r.ok) throw bad(r.error || 'The text did not send.'); log(req.user.email, 'sms.sent', 'number', null, `${ten.slice(0, 3)}***${ten.slice(-2)}`);
  return { ok: true };
}));
admin.get('/texts', wrap(() => all('SELECT m.*, c.name customer_name FROM sms_log m LEFT JOIN customers c ON c.id=m.customer_id ORDER BY m.id DESC LIMIT 200')));

// ---------- calendar feeds ----------
admin.get('/calendar-link', wrap(() => {
  const base = integ_base();
  return { staff: `${base}/cal/${getSettingSafe('cal_token')}.ics`, drivers: all('SELECT id,name,token FROM drivers WHERE active=1').map((d) => ({ id: d.id, name: d.name, url: `${base}/cal/driver/${d.token}.ics` })) };
}));
admin.post('/calendar-link/regenerate', wrap(() => { setSetting('cal_token', token(18)); return { ok: true }; }));

// ---------- export & traffic ----------
admin.get('/export/:kind', (req, res) => {
  try {
    const kind = req.params.kind.replace(/\.xlsx$/, '');
    const buf = exportWorkbook(kind, req.query.from, req.query.to);
    res.setHeader('Content-Type', XLSX_TYPE); res.setHeader('Content-Disposition', `attachment; filename="getabusny-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`); res.setHeader('Cache-Control', 'no-store');
    log(req.user.email, 'export', 'export', null, kind);
    res.send(Buffer.from(buf));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
admin.get('/export-kinds', (req, res) => res.json(EXPORT_KINDS));
admin.get('/traffic', wrap((req) => trafficReport(Number(req.query.days) || 30)));

// ---------- card authorizations: hold, capture (full or partial), release ----------
admin.post('/invoices/:id/auth-link', wrap(async (req) => {
  const i = one('SELECT * FROM invoices WHERE id=?', req.params.id);
  if (!i || i.status === 'void') throw bad('Invoice not found');
  const amt = Math.round(Number(req.body?.amount_cents));
  if (!Number.isFinite(amt) || amt < 100) throw bad('Enter the amount to hold (at least $1.00).');
  const c = one('SELECT * FROM customers WHERE id=?', i.customer_id) || {};
  const sess = await createCheckout({ invoice: i, amount_cents: amt, email: c.email, auth: true });
  let emailed = false;
  if (req.body?.email && c.email) {
    await sendEmail(c.email, `Card authorization for invoice ${i.number}`, emailShell('Please authorize your card', `<p>Hi ${esc((c.name || '').split(' ')[0])}, to hold <b>${money(amt)}</b> on your card for ${esc(i.title || 'your trip')}, use the secure button below. Your card is <b>authorized, not charged</b>. We capture the final amount later, or release the hold. The link works for 24 hours.</p>`, { label: 'Authorize card', url: sess.url }));
    emailed = true;
  }
  log(req.user.email, 'payment.auth_link', 'invoice', i.id, money(amt));
  return { url: sess.url, emailed };
}));
admin.post('/payments/:id/capture', wrap(async (req) => {
  const p = one('SELECT * FROM payments WHERE id=?', req.params.id);
  if (!p || p.method !== 'card_auth' || p.status !== 'authorized') throw bad('That is not an open card hold.');
  const amt = Math.round(Number(req.body?.amount_cents)) || p.amount_cents;
  if (amt <= 0 || amt > p.amount_cents) throw bad(`You can capture up to ${money(p.amount_cents)}.`);
  const r = await capturePayment(p.stripe_pi, amt === p.amount_cents ? undefined : amt);
  markCaptured(p, r.amount_received || amt, req.user.email);
  return { ok: true, captured_cents: r.amount_received || amt };
}));
admin.post('/payments/:id/release', wrap(async (req) => {
  const p = one('SELECT * FROM payments WHERE id=?', req.params.id);
  if (!p || p.method !== 'card_auth' || p.status !== 'authorized') throw bad('That is not an open card hold.');
  await cancelPayment(p.stripe_pi);
  markReleased(p, 'released', req.user.email);
  return { ok: true };
}));

// ---------- sent messages: every email and text, exactly as the customer saw it ----------
// Email check: shows which provider and sender are in use, recent failures, and sends a test with the provider's exact answer.
const emailSender = () => { const s = emailSenderOf(); return `${s.name} <${s.email}>`; };
admin.get('/email/health', wrap(() => {
  const provider = process.env.BREVO_API_KEY ? 'Brevo' : process.env.RESEND_API_KEY ? 'Resend' : '';
  const from = emailSender(); const addr = (/<(.+)>/.exec(from)?.[1] || from).trim().toLowerCase();
  const freeMail = /@(gmail|yahoo|outlook|hotmail|aol|icloud|live|msn)\./.test(addr);
  const warnings = [];
  if (!provider) warnings.push('No email service is connected. Add BREVO_API_KEY (or RESEND_API_KEY) on the server. Until then nothing is sent; messages are only logged.');
  if (provider === 'Brevo' && freeMail) warnings.push(`Emails are being sent from ${addr}. Brevo does not deliver from free mail addresses like Gmail. Set EMAIL_FROM on the server to an address on your own domain, such as "Get A Bus NY <office@getabusny.com>", and authenticate that domain in Brevo (Senders, Domains and Dedicated IPs).`);
  const failed = all("SELECT id,to_addr,subject,error,created_at FROM outbox WHERE status='failed' ORDER BY id DESC LIMIT 5");
  const notSent = one("SELECT COUNT(*) c FROM outbox WHERE status='logged'").c;
  return { provider, from, warnings, failed, not_sent: notSent };
}));
admin.post('/email/test', limit('emailtest', 10, 3600000), wrap(async (req) => {
  const to = String(req.body?.to || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw bad('Enter a valid email address.');
  const r = await sendEmail(to, 'Test email from Get A Bus NY', emailShell('Test email', '<p>If you can read this, email sending works.</p>'), { kind: 'test' });
  return { ok: r.ok && r.status === 'sent', status: r.status, error: r.error || (r.status === 'logged' ? 'No email service is connected, so nothing was sent.' : null) };
}));
// Website text editor
admin.get('/site-text', wrap(() => ({ items: listTexts(), labels: PAGE_LABELS })));
admin.put('/site-text', wrap((req) => { const n = saveTexts(req.body?.texts || {}); log(req.user.email, 'site.text.saved', 'settings', null, `${n} changed texts`); return { ok: true, changed: n }; }));
admin.get('/messages-sent', wrap((req) => {
  const q = `%${String(req.query.q || '').trim()}%`; const lim = Math.min(Number(req.query.limit) || 200, 500);
  const type = req.query.type || 'all';
  const mails = type === 'sms' ? [] : all("SELECT id, created_at at, to_addr to_, subject title, status, error, kind, provider FROM outbox WHERE (to_addr LIKE ? OR subject LIKE ?) ORDER BY id DESC LIMIT ?", q, q, lim).map((m) => ({ type: 'email', id: m.id, at: m.at, to: m.to_, title: m.title, status: m.status, error: m.error, kind: m.kind || 'customer', provider: m.provider }));
  const texts = type === 'email' ? [] : all("SELECT m.id, m.created_at at, m.to_phone, m.body, m.status, m.error, m.kind, m.direction, c.name cn FROM sms_log m LEFT JOIN customers c ON c.id=m.customer_id WHERE (m.to_phone LIKE ? OR m.body LIKE ? OR c.name LIKE ?) ORDER BY m.id DESC LIMIT ?", q, q, q, lim).map((m) => ({ type: 'sms', id: m.id, at: m.at, to: m.cn ? `${m.cn} (${m.to_phone})` : m.to_phone, title: m.body, status: m.status, error: m.error, kind: m.kind, direction: m.direction }));
  return [...mails, ...texts].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, lim);
}));
admin.get('/messages-sent/email/:id', wrap((req) => { const m = one('SELECT * FROM outbox WHERE id=?', req.params.id); if (!m) throw bad('Not found', 404); return m; }));
admin.get('/messages-sent/sms/:id', wrap((req) => { const m = one('SELECT m.*, c.name customer_name FROM sms_log m LEFT JOIN customers c ON c.id=m.customer_id WHERE m.id=?', req.params.id); if (!m) throw bad('Not found', 404); return m; }));
admin.post('/messages-sent/email/:id/resend', wrap(async (req) => {
  const m = one('SELECT * FROM outbox WHERE id=?', req.params.id); if (!m) throw bad('Not found', 404);
  return sendEmail(m.to_addr, m.subject, m.html, { kind: m.kind });
}));

// small allowlist sanitizer for the rich-text composer
const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'div', 'span', 'hr']);
export function cleanHtml(html) {
  return String(html || '').slice(0, 60000)
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
      tag = tag.toLowerCase(); if (!ALLOWED.has(tag)) return '';
      if (m.startsWith('</')) return `</${tag}>`;
      if (tag === 'a') { const h = /href\s*=\s*"(https?:\/\/[^"]+|mailto:[^"]+)"/i.exec(attrs); return h ? `<a href="${h[1].replace(/"/g, '&quot;')}" target="_blank" rel="noopener">` : '<a>'; }
      return `<${tag}>`;
    });
}
admin.post('/messages/email', wrap(async (req) => {
  const { to, subject, html, entity_type, entity_id } = req.body || {};
  if (!to || !subject || !html) throw bad('Recipient, subject and message are required');
  const clean = cleanHtml(html);
  const r = await sendEmail(to, subject, emailShell(subject, clean), { kind: 'staff' });
  insert('followups', { entity_type: entity_type || 'general', entity_id: entity_id || null, kind: 'manual_email', channel: 'email', to_email: to, subject, body: clean, due_at: now(), status: r.ok ? 'sent' : 'failed', auto: 0, result: r.error || r.status, created_at: now(), done_at: now() });
  return r;
}));

// ---------- notification choices (each admin picks events, by email and/or text) ----------
admin.get('/notify-events', wrap(() => NOTIFY_EVENTS.map(({ key, label }) => ({ key, label }))));
admin.get('/users/:id/notify', wrap((req) => { const u = one('SELECT id,email,name,phone,notify_prefs FROM users WHERE id=?', req.params.id); if (!u) throw bad('Not found', 404); return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', prefs: adminPrefs(u) }; }));
admin.put('/users/:id/notify', wrap((req) => {
  const u = one('SELECT id FROM users WHERE id=?', req.params.id); if (!u) throw bad('Not found', 404);
  const prefs = {}; for (const e of NOTIFY_EVENTS) { const p = req.body?.prefs?.[e.key]; if (p) prefs[e.key] = { email: !!p.email, sms: !!p.sms }; }
  update('users', u.id, { phone: String(req.body?.phone || '').replace(/[^+\d\s()-]/g, '').slice(0, 30), notify_prefs: JSON.stringify(prefs) });
  log(req.user.email, 'notify.updated', 'user', u.id);
  return { ok: true };
}));
admin.post('/users/:id/notify-test', wrap(async (req) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id); if (!u) throw bad('Not found', 404);
  const out = {};
  if (u.email) out.email = await sendEmail(u.email, 'Test alert from Get A Bus NY', emailShell('Test alert', '<p>If you can read this, email alerts reach you.</p>'), { kind: 'admin_alert' });
  if (u.phone) out.sms = await sendSMS(u.phone, 'Get A Bus NY test alert: texts reach you.', { kind: 'admin_alert' });
  return out;
}));

// ---------- zmanim and Shabbos / Yom Tov checks ----------
import { dayInfo, scheduleCheck } from '../zmanim.js';
const coordsOf = (it) => { const s = (it || []).find((x) => x.lat && x.lng); return s ? [s.lat, s.lng] : [null, null]; };
admin.get('/zmanim', wrap((req) => { const d = String(req.query.date || ''); if (!/^\d{4}-\d\d-\d\d$/.test(d)) throw bad('date required'); return dayInfo(d, req.query.lat, req.query.lng); }));
admin.post('/schedule-check', wrap((req) => {
  const it = normItinerary(req.body?.itinerary); const [lat, lng] = coordsOf(it);
  const dep = (req.body?.depart_at || it.find((x) => x.time)?.time || '').slice(0, 16), ret = (req.body?.return_at || '').slice(0, 16);
  return { issues: scheduleCheck({ stops: it, depart_at: dep, return_at: ret, lat, lng }), depart: /^\d{4}-\d\d-\d\d/.test(dep) ? dayInfo(dep.slice(0, 10), lat, lng) : null, return: /^\d{4}-\d\d-\d\d/.test(ret) && ret.slice(0, 10) !== dep.slice(0, 10) ? dayInfo(ret.slice(0, 10), lat, lng) : null };
}));

// ---------- double-booking check ----------
admin.get('/trips/conflicts', wrap((req) => {
  const { id = 0, driver_id, vehicle_id, from, to } = req.query;
  if (!from) return [];
  const start = S.naiveMs(from), end = S.naiveMs(to || from) + 3600000;
  const clash = (col, val) => (val ? all(`SELECT t.id, t.ref, t.depart_at, t.return_at, c.name customer_name FROM trips t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.${col}=? AND t.id<>? AND t.status NOT IN ('cancelled','completed') AND t.depart_at IS NOT NULL`, val, id).filter((t) => S.naiveMs(t.depart_at) < end && S.naiveMs(t.return_at || t.depart_at) + 3600000 > start) : []);
  return [...clash('driver_id', driver_id).map((t) => ({ ...t, what: 'driver' })), ...clash('vehicle_id', vehicle_id).map((t) => ({ ...t, what: 'vehicle' }))];
}));

// ---------- operator insurance: certificate upload (private) and trip-date check ----------
const COI = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'coi');
admin.post('/vendors/:id/coi', express.raw({ type: ['application/pdf', 'image/*'], limit: '10mb' }), wrap((req) => {
  const v = one('SELECT id FROM vendors WHERE id=?', req.params.id); if (!v) throw bad('Not found', 404);
  const b = req.body; if (!Buffer.isBuffer(b) || b.length < 16) throw bad('No file received');
  const ext = b.subarray(0, 4).toString() === '%PDF' ? 'pdf' : b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : b.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ? 'jpg' : null;
  if (!ext) throw bad('Upload a PDF, PNG or JPG');
  fs.mkdirSync(COI, { recursive: true });
  const name = `vendor${v.id}-${Date.now()}.${ext}`; fs.writeFileSync(path.join(COI, name), b);
  update('vendors', v.id, { coi_file: name, updated_at: now() }); log(req.user.email, 'vendor.coi_uploaded', 'vendor', v.id);
  return { ok: true };
}));
admin.get('/vendors/:id/coi', (req, res) => {
  const v = one('SELECT coi_file FROM vendors WHERE id=?', req.params.id);
  const f = v?.coi_file && path.join(COI, path.basename(v.coi_file));
  if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'No certificate on file' });
  res.setHeader('Content-Type', f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.png') ? 'image/png' : 'image/jpeg'); res.setHeader('Content-Disposition', `inline; filename="${path.basename(f)}"`); res.send(fs.readFileSync(f));
});
admin.get('/vendors/:id/insurance-check', wrap((req) => {
  const v = one('SELECT name, insurance_expires FROM vendors WHERE id=?', req.params.id); if (!v) throw bad('Not found', 404);
  const on = /^\d{4}-\d\d-\d\d/.test(req.query.on || '') ? String(req.query.on).slice(0, 10) : undefined;
  const today = S.insuranceStatus(v.insurance_expires); const onTrip = on ? S.insuranceStatus(v.insurance_expires, on) : today;
  return { name: v.name, expires: v.insurance_expires, today, covers_trip: v.insurance_expires ? onTrip.status !== 'expired' : null };
}));

admin.get('/quotes/:id/revisions', wrap((req) => S.quoteRevisions(Number(req.params.id))));

// ---------- saved cards ----------
admin.get('/customers/:id/card', wrap((req) => cardOf(one('SELECT * FROM customers WHERE id=?', req.params.id))));
admin.post('/customers/:id/card-link', wrap(async (req) => {
  const c = one('SELECT * FROM customers WHERE id=?', req.params.id); if (!c) throw bad('Not found', 404);
  const cid = await stripeCustomerFor(c);
  const sess = await createSetupCheckout({ customer_id: c.id, stripeCustomer: cid });
  let emailed = false;
  if (req.body?.email && c.email) {
    await sendEmail(c.email, 'Save a card on file', emailShell('Save a card for your trip', `<p>Hi ${esc((c.name || '').split(' ')[0])}, use the secure button to save a card with ${esc(S.biz())}. Nothing is charged now. We will only charge it for the balance of your trip and for extras you agreed to, such as overtime or gratuity. You can ask us to remove it any time.</p>`, { label: 'Save my card', url: sess.url }));
    emailed = true;
  }
  log(req.user.email, 'card.link', 'customer', c.id);
  return { url: sess.url, emailed };
}));
admin.delete('/customers/:id/card', wrap(async (req) => { await removeCard(Number(req.params.id), req.user.email); return { ok: true }; }));
admin.post('/invoices/:id/charge-saved', wrap((req) => chargeInvoice(Number(req.params.id), req.body?.amount_cents, req.user.email)));

// ---------- operator checks: FMCSA (SAFER data) and manual verification. Operators never do this themselves. ----------
admin.get('/vendors/:id/safer', wrap((req) => {
  const v = one('SELECT dot_number, fmcsa_checked_at, fmcsa_status, insurance_verified_at, insurance_verified_by, insurance_verify_note FROM vendors WHERE id=?', req.params.id); if (!v) throw bad('Not found', 404);
  return { links: saferLinks(v.dot_number), configured: !!process.env.FMCSA_WEBKEY, checked_at: v.fmcsa_checked_at, status: parse(v.fmcsa_status, null), verified_at: v.insurance_verified_at, verified_by: v.insurance_verified_by, verify_note: v.insurance_verify_note };
}));
admin.post('/vendors/:id/fmcsa-check', wrap(async (req) => {
  const v = one('SELECT id, dot_number FROM vendors WHERE id=?', req.params.id); if (!v) throw bad('Not found', 404);
  const dot = String(req.body?.dot || v.dot_number || '');
  const st = await fmcsaLookup(dot);
  update('vendors', v.id, { dot_number: st.dot, fmcsa_checked_at: now(), fmcsa_status: st, updated_at: now() });
  log(req.user.email, 'vendor.fmcsa_check', 'vendor', v.id, st.problems.length ? st.problems[0] : 'clear');
  return { checked_at: now(), status: st };
}));
admin.post('/vendors/:id/insurance-verified', wrap((req) => {
  const v = one('SELECT id FROM vendors WHERE id=?', req.params.id); if (!v) throw bad('Not found', 404);
  update('vendors', v.id, { insurance_verified_at: now(), insurance_verified_by: req.user.email, insurance_verify_note: String(req.body?.note || '').slice(0, 300), updated_at: now() });
  log(req.user.email, 'vendor.insurance_verified', 'vendor', v.id, String(req.body?.note || ''));
  return { ok: true };
}));
