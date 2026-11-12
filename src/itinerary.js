// Trip itinerary: an ordered list of stops. Kinds:
//   start        where the bus begins its day (garage / depot), staff only, billable as deadhead
//   pickup       passengers board (first pickup + any extra pickups)
//   stop         waypoint where the bus waits (restaurant, ohel, camp visit…)
//   dropoff      passengers get off (destination or intermediate drop)
//   return_pickup passengers board for the way back
//   end          where the bus finishes (garage), staff only
// Pricing is ALWAYS entered manually; billableLines() only creates empty line items to price.
export const KINDS = { start: 'Bus starts at', pickup: 'Pickup', stop: 'Stop', dropoff: 'Drop-off', return_pickup: 'Return pickup', end: 'Bus ends at' };
const MAX = 30;
const s = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));

export function normItinerary(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX).map((x) => ({
    kind: KINDS[x?.kind] ? x.kind : 'stop',
    address: s(x?.address, 300), place_id: s(x?.place_id, 200) || undefined, lat: num(x?.lat) ?? undefined, lng: num(x?.lng) ?? undefined,
    time: /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x?.time || '') ? x.time.slice(0, 16) : '',
    wait_min: Math.max(0, Math.min(2000, parseInt(x?.wait_min, 10) || 0)) || undefined,
    pax: Math.max(0, Math.min(500, parseInt(x?.pax, 10) || 0)) || undefined,
    contact_name: s(x?.contact_name, 100) || undefined, contact_phone: s(x?.contact_phone, 40) || undefined, note: s(x?.note, 300) || undefined,
  })).filter((x) => x.address || x.lat);
}

/** Build an itinerary from the old flat fields (pickup/dropoff/stops/times). */
export function fromLegacy({ pickup, dropoff, stops, depart_at, return_at, trip_type } = {}) {
  const out = [];
  if (pickup) out.push({ kind: 'pickup', address: pickup, time: depart_at });
  String(stops || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean).forEach((a) => out.push({ kind: 'stop', address: a }));
  if (dropoff) out.push({ kind: 'dropoff', address: dropoff });
  if (return_at && trip_type !== 'one_way' && dropoff) out.push({ kind: 'return_pickup', address: dropoff, time: return_at });
  if (return_at && trip_type !== 'one_way' && pickup) out.push({ kind: 'dropoff', address: pickup });
  return normItinerary(out);
}

/** Flat fields derived from an itinerary, so older code paths (driver, emails, RFQs) keep working. */
export function summarize(it) {
  const pickups = it.filter((x) => x.kind === 'pickup');
  const drops = it.filter((x) => x.kind === 'dropoff');
  const first = pickups[0] || it.find((x) => x.kind !== 'start');
  // destination = the first drop-off after the first pickup (the outbound destination), not the final return drop
  const dest = drops[0] || it.filter((x) => x.kind !== 'start' && x.kind !== 'end').slice(-1)[0];
  return {
    pickup: first?.address || '',
    dropoff: dest?.address || '',
    stops: it.filter((x) => x.kind === 'stop').map((x) => x.address).join('\n'),
    depart_at: first?.time || '',
    return_at: it.find((x) => x.kind === 'return_pickup')?.time || '',
  };
}

export const itineraryText = (it) => it.map((x, i) => `${i + 1}. ${KINDS[x.kind]}: ${x.address}${x.time ? ` @ ${x.time.replace('T', ' ')}` : ''}${x.wait_min ? ` (wait ${x.wait_min} min)` : ''}${x.pax ? ` · ${x.pax} pax` : ''}${x.note ? ` - ${x.note}` : ''}`).join('\n');

export function mapsDirUrl(it) {
  const pts = it.filter((x) => x.kind !== 'start' && x.kind !== 'end').map((x) => (x.lat && x.lng ? `${x.lat},${x.lng}` : x.address)).filter(Boolean);
  if (pts.length < 2) return pts[0] ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pts[0])}` : '';
  const q = (v) => encodeURIComponent(v);
  return `https://www.google.com/maps/dir/?api=1&origin=${q(pts[0])}&destination=${q(pts[pts.length - 1])}${pts.length > 2 ? `&waypoints=${pts.slice(1, -1).map(q).join('%7C')}` : ''}&travelmode=driving`;
}
export const mapsPlaceUrl = (x) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.lat && x.lng ? `${x.lat},${x.lng}` : x.address)}`;

/** Empty, unpriced line items for staff to price by hand. */
export function billableLines(it, { purpose } = {}) {
  const { pickup, dropoff } = summarize(it);
  const lines = [{ desc: `Charter${purpose ? ` - ${purpose}` : ''}: ${pickup || '?'} → ${dropoff || '?'}`, qty: 1, unit_cents: 0 }];
  let pk = 0, dr = 0;
  for (const x of it) {
    if (x.kind === 'pickup' && ++pk > 1) lines.push({ desc: `Additional pickup: ${x.address}`, qty: 1, unit_cents: 0 });
    else if (x.kind === 'stop') lines.push({ desc: `Additional stop: ${x.address}${x.wait_min ? ` (${x.wait_min} min wait)` : ''}`, qty: 1, unit_cents: 0 });
    else if (x.kind === 'dropoff' && ++dr > 1) lines.push({ desc: `Additional drop-off: ${x.address}`, qty: 1, unit_cents: 0 });
    else if (x.kind === 'return_pickup') lines.push({ desc: `Return pickup: ${x.address}`, qty: 1, unit_cents: 0 });
    else if (x.kind === 'start') lines.push({ desc: `Bus start / deadhead from: ${x.address}`, qty: 1, unit_cents: 0 });
    else if (x.kind === 'end') lines.push({ desc: `Bus end / deadhead to: ${x.address}`, qty: 1, unit_cents: 0 });
  }
  const wait = it.reduce((a, x) => a + (x.wait_min || 0), 0);
  if (wait) lines.push({ desc: `Waiting time (${wait} min total across stops)`, qty: 1, unit_cents: 0 });
  lines.push({ desc: 'Overtime / extra hours (if any)', qty: 0, unit_cents: 0 });
  return lines;
}

const BUS_CATEGORIES = new Set(['Coach Bus', 'Party Bus', 'Trolley', 'Executive Coach', 'Double Decker', 'Other']);
export const isBusCategory = (cat) => !cat || BUS_CATEGORIES.has(cat);

const p2 = (n) => String(n).padStart(2, '0');
const fmtNaive = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const toMs = (t) => Date.parse(t.slice(0, 16) + ':00Z');
/** Walk the route: arrival at each stop = previous departure + drive time; a stop with a set time holds the bus until then. */
export function planTimes(it, legs) {
  const stops = it.filter((x) => x.address || x.lat);
  if (!stops.length || !stops[0].time) return null;
  let dep = toMs(stops[0].time);
  const out = [{ arrive: fmtNaive(dep), depart: fmtNaive(dep + (stops[0].wait_min || 0) * 60000), late: false }];
  dep += (stops[0].wait_min || 0) * 60000;
  for (let i = 1; i < stops.length; i++) {
    const arrive = dep + (legs[i - 1]?.minutes || 0) * 60000;
    const set = stops[i].time ? toMs(stops[i].time) : null;
    const leave = Math.max(arrive, set || 0) + (stops[i].wait_min || 0) * 60000;
    out.push({ arrive: fmtNaive(arrive), depart: fmtNaive(leave), late: !!(set && arrive > set) });
    dep = leave;
  }
  return out;
}
