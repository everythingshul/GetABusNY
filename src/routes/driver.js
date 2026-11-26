// Driver portal API. No password: each driver has a long random link token.
// Customer contact details are only released inside a window around each trip.
import express from 'express';
import { all, one, update, insert, now, getSetting, log } from '../db.js';
import { limit } from '../auth.js';
import { naiveMs, nowLocalMs, textCustomer } from '../services.js';
import { notifyOwner } from '../integrations.js';
import { normItinerary, mapsDirUrl, mapsPlaceUrl, KINDS } from '../itinerary.js';
import { parse } from '../db.js';

export const driver = express.Router();
driver.use(limit('driver', 240, 600000));

const STATUSES = ['acknowledged', 'en_route', 'arrived', 'picked_up', 'dropped_off', 'completed'];

function load(req, res, next) {
  const d = one('SELECT * FROM drivers WHERE token=? AND active=1', req.params.token);
  if (!d) return res.status(404).json({ error: 'This link is not valid. Ask dispatch for a new one.' });
  req.driver = d;
  next();
}
// ---- a private link for ONE trip (texted to the driver when the trip is assigned)
function loadTrip(req, res, next) {
  const t = one('SELECT * FROM trips WHERE driver_token=? AND driver_token IS NOT NULL', req.params.ttoken);
  const d = t && t.driver_id ? one('SELECT * FROM drivers WHERE id=? AND active=1', t.driver_id) : null;
  if (!t || !d || t.status === 'cancelled') return res.status(404).json({ error: 'This link is no longer valid. The trip may have changed. Call dispatch.' });
  req.trip = t; req.driver = d; next();
}
driver.get('/trip/:ttoken', loadTrip, (req, res) => res.json({ driver: { name: req.driver.name }, mode: 'trip', now: new Date().toISOString(), dispatch: { phone: getSetting('phone') }, trips: [shape(req.trip, nowLocalMs())] }));
driver.post('/trip/:ttoken/status', loadTrip, (req, res) => setStatus(req, res, req.trip));
driver.post('/trip/:ttoken/note', loadTrip, (req, res) => addNote(req, res, req.trip));
driver.post('/trip/:ttoken/action', loadTrip, (req, res) => logAction(req, res, req.trip));
driver.use('/:token', load);

// The office hears about everything a driver does on the page: status updates, notes, and every tap on a call or text button.
const LABEL = { acknowledged: 'got the trip', en_route: 'is on the way', arrived: 'has arrived', picked_up: 'has the group on board', dropped_off: 'dropped the group off', completed: 'completed the trip' };
function tell(driver_, t, what) {
  const when = String(t.depart_at || '').replace('T', ' ').slice(0, 16);
  notifyOwner(`Driver ${String(driver_.name).split(' ')[0]} ${what}`.slice(0, 120), `${t.ref}${t.purpose ? ' ' + t.purpose : ''}${when ? ', departs ' + when : ''}`, 'driver_activity').catch(() => {});
}
const ACTIONS = { call_onsite: 'is calling the on-site contact', text_onsite: 'is texting the on-site contact', call_dispatch: 'is calling dispatch', call_stop: 'is calling a contact at a stop' };
const lastAction = new Map();
function logAction(req, res, t) {
  const a = String(req.body?.action || '');
  if (!t || !ACTIONS[a]) return res.status(400).json({ error: 'Bad action' });
  const key = `${t.id}|${req.driver.id}|${a}`, nowMs = Date.now();
  if (nowMs - (lastAction.get(key) || 0) > 20000) { // a double tap is one call
    lastAction.set(key, nowMs);
    const who = a.endsWith('onsite') ? [t.onsite_name, t.onsite_phone].filter(Boolean).join(' ') : '';
    insert('trip_events', { trip_id: t.id, status: a, note: `${ACTIONS[a]}${who ? ': ' + who : ''}`, at: now() });
    log(`driver:${req.driver.name}`, `trip.${a}`, 'trip', t.id, who);
    tell(req.driver, t, `${ACTIONS[a]}${who ? ' (' + who + ')' : ''}`);
  }
  res.json({ ok: true });
}
// Nothing about the customer reaches a driver: only the on-site contact the office set for the trip, and no email address anywhere.
const scrub = (v) => String(v ?? '').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '').replace(/\s{2,}/g, ' ').trim();

function shape(t, now_ms) {
  const before = Number(getSetting('driver_window_before_hrs')) || 24;
  const after = Number(getSetting('driver_window_after_hrs')) || 12;
  const start = naiveMs(t.depart_at);
  const end = naiveMs(t.return_at || t.depart_at);
  const open = now_ms >= start - before * 3600000 && now_ms <= end + after * 3600000;
  const hours_until = Math.round((start - before * 3600000 - now_ms) / 3600000);
  const it = normItinerary(parse(t.itinerary, []));
  return {
    id: t.id, ref: t.ref, purpose: t.purpose, status: t.status,
    itinerary: it.map((x) => ({ kind: x.kind, label: KINDS[x.kind], address: x.address, time: x.time, wait_min: x.wait_min, pax: x.pax, note: scrub(x.note), contact_name: x.contact_name, contact_phone: x.contact_phone, map: mapsPlaceUrl(x) })),
    route_url: mapsDirUrl(it.filter((x) => x.kind !== 'end')), depart_at: t.depart_at, return_at: t.return_at, passengers: t.passengers,
    notes: scrub(t.notes), driver_notes: scrub(t.driver_notes), driver_status: t.driver_status, vehicle: one('SELECT name FROM vehicles WHERE id=?', t.vehicle_id)?.name || null,
    status_open: open, unlocks_in_hours: open ? 0 : Math.max(hours_until, 0),
    onsite: t.onsite_name || t.onsite_phone ? { name: t.onsite_name || '', phone: t.onsite_phone || '' } : null,
    dispatch_phone: getSetting('phone'),
    vendor: t.vendor_id ? one('SELECT name FROM vendors WHERE id=?', t.vendor_id)?.name || null : null, // the driver sees who the trip is for; the customer never does
  };
}

driver.get('/:token', (req, res) => {
  const nm = nowLocalMs();
  const rows = all("SELECT * FROM trips WHERE driver_id=? AND status<>'cancelled' ORDER BY depart_at", req.driver.id)
    .filter((t) => { const s = naiveMs(t.depart_at); const e = naiveMs(t.return_at || t.depart_at); return e + 36 * 3600000 >= nm && s - 30 * 86400000 <= nm; });
  res.json({ driver: { name: req.driver.name }, now: new Date().toISOString(), dispatch: { phone: getSetting('phone') }, trips: rows.map((t) => shape(t, nm)) });
});

driver.post('/:token/trips/:id/status', (req, res) => setStatus(req, res, one('SELECT * FROM trips WHERE id=? AND driver_id=?', req.params.id, req.driver.id)));
function setStatus(req, res, t) {
  if (!t) return res.status(404).json({ error: 'Trip not found' });
  const st = req.body?.status;
  if (!STATUSES.includes(st)) return res.status(400).json({ error: 'Bad status' });
  const note = String(req.body?.note || '').slice(0, 500);
  update('trips', t.id, { driver_status: st, driver_status_at: now(), ...(st === 'completed' ? { status: 'completed' } : t.status === 'confirmed' || t.status === 'booked' ? { status: 'in_progress' } : {}), updated_at: now() });
  insert('trip_events', { trip_id: t.id, status: st, note, at: now() });
  log(`driver:${req.driver.name}`, `trip.${st}`, 'trip', t.id, note);
  tell(req.driver, t, `${LABEL[st] || st.replace('_', ' ')}${note ? ': ' + note : ''}`);
  if (st === 'en_route' || st === 'arrived') {
    const dr = req.driver;
    textCustomer(t.customer_id, st === 'en_route'
      ? `Get A Bus NY\nYour driver ${dr.name.split(' ')[0]} is on the way.${dr.phone ? `\nCall or text ${dr.phone}` : ''}`
      : `Get A Bus NY\nYour driver ${dr.name.split(' ')[0]} has arrived.${dr.phone ? `\nCall or text ${dr.phone}` : ''}`, 'driver_' + st, { trip_id: t.id, force: true }).catch(() => {});
  }
  res.json({ ok: true });
}

driver.post('/:token/trips/:id/action', (req, res) => logAction(req, res, one('SELECT * FROM trips WHERE id=? AND driver_id=?', req.params.id, req.driver.id)));
driver.post('/:token/trips/:id/note', (req, res) => addNote(req, res, one('SELECT * FROM trips WHERE id=? AND driver_id=?', req.params.id, req.driver.id)));
function addNote(req, res, t) {
  if (!t || !req.body?.note) return res.status(400).json({ error: 'Missing note' });
  tell(req.driver, t, `sent a note: ${String(req.body.note).slice(0, 160)}`);
  insert('trip_events', { trip_id: t.id, status: 'note', note: String(req.body.note).slice(0, 1000), at: now() });
  log(`driver:${req.driver.name}`, 'trip.note', 'trip', t.id, String(req.body.note));
  res.json({ ok: true });
}
