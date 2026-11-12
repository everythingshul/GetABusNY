import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, one, run, insert, update, now, token, nextNumber, allSettings, setSetting, DEFAULT_SETTINGS, log, parse, totals, getSetting as getSettingSafe } from '../db.js';
import { BASE_URL as integ_base } from '../integrations.js';
import { requireAdmin, checkPassword, hashPassword, makeSession, limit } from '../auth.js';
import * as S from '../services.js';
import { status as integ, sendEmail, emailShell, esc, refundPayment, money } from '../integrations.js';
import { chatAdminRouter } from '../chesky.js';
import { normItinerary, summarize, billableLines, mapsDirUrl } from '../itinerary.js';
import { createContract, sendContract, contractPdfPath, exportWorkbook, EXPORT_KINDS, trafficReport, contractView } from '../extras.js';
import { XLSX_TYPE } from '../xlsx.js';
import { routeEstimate } from '../integrations.js';

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
admin.get('/users', wrap(() => all('SELECT id,email,name,role,created_at FROM users')));
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
  customers: { fields: J('name', 'email', 'phone', 'company', 'address', 'notes', 'tags', 'sms_optin'), sel: 'SELECT t.*, (SELECT COUNT(*) FROM trips x WHERE x.customer_id=t.id) trip_count FROM customers t', search: ['t.name', 't.email', 't.phone', 't.company'], order: 't.name COLLATE NOCASE', del: (id) => !one('SELECT 1 x FROM trips WHERE customer_id=? UNION SELECT 1 FROM invoices WHERE customer_id=?', id, id) },
  vehicles: { fields: J('name', 'category', 'capacity', 'description', 'features', 'image', 'hourly_cents', 'min_hours', 'active', 'sort'), sel: 'SELECT t.* FROM vehicles t', search: ['t.name', 't.category'], order: 't.sort, t.name', del: () => true },
  drivers: { fields: J('name', 'phone', 'email', 'vendor_id', 'active', 'notes'), sel: 'SELECT t.*, v.name vendor_name FROM drivers t LEFT JOIN vendors v ON v.id=t.vendor_id', search: ['t.name', 't.phone'], order: 't.name COLLATE NOCASE', del: () => true, create: (o) => ({ ...o, token: token(24) }), extra: (r) => ({ ...r, portal_url: `${process.env.BASE_URL || ''}/d/${r.token}` }) },
  vendors: { fields: J('name', 'contact_name', 'email', 'phone', 'vehicle_types', 'service_area', 'rating', 'notes', 'active'), sel: 'SELECT t.* FROM vendors t', search: ['t.name', 't.contact_name', 't.email', 't.service_area'], order: 't.name COLLATE NOCASE', del: (id) => !one('SELECT 1 x FROM trips WHERE vendor_id=?', id) },
  requests: { fields: J('name', 'email', 'phone', 'status', 'notes', 'referred_by', 'details'), sel: 'SELECT t.*, c.name customer_name FROM requests t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.name', 't.email', 't.ref', 't.phone'], order: 't.id DESC', del: () => true },
  quotes: { fields: J('customer_id', 'title', 'items', 'tax_rate', 'deposit_pct', 'valid_until', 'notes', 'trip', 'status'), sel: 'SELECT t.*, c.name customer_name FROM quotes t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.number', 't.title', 'c.name'], order: 't.id DESC', del: (id) => one('SELECT status FROM quotes WHERE id=?', id)?.status === 'draft', create: (o) => ({ number: nextNumber('Q'), token: token(), status: 'draft', ...o }), before: (o) => { if (o.trip && typeof o.trip === 'object') { o.trip.itinerary = normItinerary(o.trip.itinerary); const f = summarize(o.trip.itinerary); for (const k of ['pickup', 'dropoff', 'stops']) o.trip[k] = f[k]; for (const k of ['depart_at', 'return_at']) if (!o.trip[k] && f[k]) o.trip[k] = f[k]; } return o; }, after: (id) => S.recalcQuote(id) },
  trips: { fields: J('customer_id', 'status', 'title', 'purpose', 'itinerary', 'pickup', 'dropoff', 'stops', 'depart_at', 'return_at', 'passengers', 'vehicle_id', 'vendor_id', 'vendor_cost_cents', 'driver_id', 'price_cents', 'onsite_name', 'onsite_phone', 'notes', 'driver_notes'), before: (o) => { if ('itinerary' in o) { o.itinerary = normItinerary(typeof o.itinerary === 'string' ? JSON.parse(o.itinerary || '[]') : o.itinerary); const f = summarize(o.itinerary); for (const k of ['pickup', 'dropoff', 'stops']) o[k] = f[k]; for (const k of ['depart_at', 'return_at']) if (!o[k] && f[k]) o[k] = f[k]; } return o; }, sel: 'SELECT t.*, c.name customer_name, v.name vehicle_name, d.name driver_name, vn.name vendor_name FROM trips t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN vendors vn ON vn.id=t.vendor_id', search: ['t.ref', 't.title', 'c.name', 't.pickup', 't.dropoff'], order: 't.depart_at DESC', del: () => false, create: (o) => ({ ref: nextNumber('TRIP'), status: 'booked', ...o }), after: (id, created) => { if (created) S.scheduleTripFollowups(id); } },
  invoices: { fields: J('customer_id', 'trip_id', 'status', 'title', 'items', 'tax_rate', 'deposit_cents', 'due_date', 'notes'), sel: 'SELECT t.*, c.name customer_name FROM invoices t LEFT JOIN customers c ON c.id=t.customer_id', search: ['t.number', 't.title', 'c.name'], order: 't.id DESC', del: (id) => one('SELECT status FROM invoices WHERE id=?', id)?.status === 'draft', create: (o) => ({ number: nextNumber('INV'), token: token(), status: 'draft', ...o }), after: (id) => S.recalcInvoice(id) },
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
    if (name === 'customers' && 'sms_optin' in o) o.sms_optin_at = o.sms_optin ? now() : null;
    if (name === 'invoices' && o.status === 'sent') delete o.status; // use the Send action
    update(table, id, { ...o, ...(table !== 'followups' && table !== 'messages' ? { updated_at: now() } : {}) });
    if (name === 'followups' && o.status && o.status !== 'pending') update('followups', id, { done_at: now() });
    if (name === 'trips' && o.status === 'cancelled') log(req.user.email, 'trip.cancelled', 'trip', id);
    cfg.after?.(id, false);
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
admin.post('/quotes/:id/send', wrap(async (req) => { S.recalcQuote(req.params.id); const r = await S.sendQuote(Number(req.params.id), req.user.email); return { ok: true, email: r }; }));
admin.post('/quotes/:id/accept', wrap((req) => S.acceptQuote(Number(req.params.id), req.user.email)));
admin.post('/quotes/:id/duplicate', wrap((req) => {
  const q = one('SELECT * FROM quotes WHERE id=?', req.params.id);
  const { id, number, token: _t, sent_at, viewed_at, accepted_at, declined_at, ...rest } = q;
  const nid = insert('quotes', { ...rest, number: nextNumber('Q'), token: token(), status: 'draft', created_at: now(), updated_at: now() });
  return { id: nid };
}));
admin.get('/quotes/:id/link', wrap((req) => ({ url: S.link.quote(one('SELECT token FROM quotes WHERE id=?', req.params.id)) })));

admin.post('/invoices/:id/send', wrap(async (req) => ({ ok: true, email: await S.sendInvoice(Number(req.params.id), req.user.email) })));
admin.get('/invoices/:id/link', wrap((req) => ({ url: S.link.pay(one('SELECT token FROM invoices WHERE id=?', req.params.id)) })));
admin.get('/invoices/:id/payments', wrap((req) => all('SELECT * FROM payments WHERE invoice_id=? ORDER BY id', req.params.id)));
admin.post('/invoices/:id/payments', wrap((req) => {
  const amt = Math.round(Number(req.body.amount_cents));
  if (!Number.isFinite(amt) || amt <= 0) throw bad('Enter a payment amount');
  const inv = one('SELECT status FROM invoices WHERE id=?', req.params.id);
  if (inv?.status === 'void') throw bad('Invoice is void');
  return { id: S.recordPayment(Number(req.params.id), { amount_cents: amt, method: req.body.method || 'cash', reference: req.body.reference, note: req.body.note }, req.user.email) };
}));
admin.post('/payments/:id/refund', wrap(async (req) => {
  const p = one('SELECT * FROM payments WHERE id=?', req.params.id);
  if (!p || p.amount_cents <= 0) throw bad('Payment not found');
  const amt = Math.round(Number(req.body.amount_cents)) || p.amount_cents;
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
  const id = insert('invoices', { number: nextNumber('INV'), token: token(), customer_id: t.customer_id, trip_id: t.id, status: 'draft', title: t.title, items, tax_rate: Number(allSettings().tax_rate) || 0, ...totals(items, Number(allSettings().tax_rate) || 0), due_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), created_at: now(), updated_at: now() });
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

// Chesky (admin): handoff inbox, teach, assistant
admin.use('/chesky', chatAdminRouter());

// ---------- itinerary helpers (pricing is always entered by hand) ----------
admin.post('/itinerary/lines', wrap((req) => billableLines(normItinerary(req.body?.itinerary), { purpose: req.body?.purpose })));
admin.post('/route-estimate', wrap(async (req) => routeEstimate(normItinerary(req.body?.itinerary).filter((x) => x.kind !== 'start' || true))));

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
