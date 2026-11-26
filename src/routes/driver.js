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
driver.get('/trip/:ttoken', loadTrip, (req, res) => res.json({ driver: { name: req.driver.name }, mode: 'trip', now: new Date().toISOString(), dispatch: { phone: getSetting('phone'), email: getSetting('email') }, trips: [shape(req.trip, nowLocalMs())] }));
driver.post('/trip/:ttoken/status', loadTrip, (req, res) => setStatus(req, res, req.trip));
driver.post('/trip/:ttoken/note', loadTrip, (req, res) => addNote(req, res, req.trip));
driver.use('/:token', load);

function shape(t, now_ms) {
  const before = Number(getSetting('driver_window_before_hrs')) || 24;
  const after = Number(getSetting('driver_window_after_hrs')) || 12;
  const start = naiveMs(t.depart_at);
  const end = naiveMs(t.return_at || t.depart_at);
  const open = now_ms >= start - before * 3600000 && now_ms <= end + after * 3600000;
  const c = one('SELECT name,phone,email FROM customers WHERE id=?', t.customer_id) || {};
  const hours_until = Math.round((start - before * 3600000 - now_ms) / 3600000);
  return {
    id: t.id, ref: t.ref, title: t.title, purpose: t.purpose, status: t.status, pickup: t.pickup, dropoff: t.dropoff, stops: t.stops,
    itinerary: normItinerary(parse(t.itinerary, [])).map((x) => ({ ...x, ...(open ? {} : { contact_name: undefined, contact_phone: undefined }), label: KINDS[x.kind], map: mapsPlaceUrl(x) })),
    route_url: mapsDirUrl(normItinerary(parse(t.itinerary, [])).filter((x) => x.kind !== 'end')), depart_at: t.depart_at, return_at: t.return_at, passengers: t.passengers,
    notes: t.notes, driver_notes: t.driver_notes, driver_status: t.driver_status, vehicle: one('SELECT name FROM vehicles WHERE id=?', t.vehicle_id)?.name || null,
    contact_unlocked: open,
    contact: open ? { name: c.name, phone: c.phone, email: c.email, onsite_name: t.onsite_name, onsite_phone: t.onsite_phone } : null,
    unlocks_in_hours: open ? 0 : Math.max(hours_until, 0),
    dispatch_phone: getSetting('phone'),
    vendor: t.vendor_id ? one('SELECT name FROM vendors WHERE id=?', t.vendor_id)?.name || null : null, // the driver sees who the trip is for; the customer never does
  };
}

driver.get('/:token', (req, res) => {
  const nm = nowLocalMs();
  const rows = all("SELECT * FROM trips WHERE driver_id=? AND status<>'cancelled' ORDER BY depart_at", req.driver.id)
    .filter((t) => { const s = naiveMs(t.depart_at); const e = naiveMs(t.return_at || t.depart_at); return e + 36 * 3600000 >= nm && s - 30 * 86400000 <= nm; });
  res.json({ driver: { name: req.driver.name }, now: new Date().toISOString(), dispatch: { phone: getSetting('phone'), email: getSetting('email') }, trips: rows.map((t) => shape(t, nm)) });
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
  if (['en_route', 'arrived', 'completed'].includes(st)) notifyOwner(`Driver ${req.driver.name}: ${st.replace('_', ' ')}`, `${t.ref} ${t.title || ''}`.trim(), 'driver_status').catch(() => {});
  if (st === 'en_route' || st === 'arrived') {
    const dr = req.driver;
    textCustomer(t.customer_id, st === 'en_route'
      ? `Get A Bus NY\nYour driver ${dr.name.split(' ')[0]} is on the way.${dr.phone ? `\nCall or text ${dr.phone}` : ''}`
      : `Get A Bus NY\nYour driver ${dr.name.split(' ')[0]} has arrived.${dr.phone ? `\nCall or text ${dr.phone}` : ''}`, 'driver_' + st, { trip_id: t.id, force: true }).catch(() => {});
  }
  res.json({ ok: true });
}

driver.post('/:token/trips/:id/note', (req, res) => addNote(req, res, one('SELECT * FROM trips WHERE id=? AND driver_id=?', req.params.id, req.driver.id)));
function addNote(req, res, t) {
  if (!t || !req.body?.note) return res.status(400).json({ error: 'Missing note' });
  insert('trip_events', { trip_id: t.id, status: 'note', note: String(req.body.note).slice(0, 1000), at: now() });
  log(`driver:${req.driver.name}`, 'trip.note', 'trip', t.id, String(req.body.note));
  res.json({ ok: true });
}
