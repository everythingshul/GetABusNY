// Bus-aware routing: HERE privateBus vs car comparison, with fetch mocked (no network).
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = path.join(os.tmpdir(), `route-${Date.now()}.db`);
process.env.DATA_DIR = os.tmpdir();
process.env.HERE_API_KEY = 'test';
const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url); calls.push(u);
  const json = (o, ok = true) => ({ ok, json: async () => o });
  if (u.includes('geocode.search.hereapi.com')) return json({ items: [{ position: { lat: 40.7, lng: -74 } }] });
  const q = new URL(u).searchParams;
  const bus = q.get('transportMode') === 'privateBus';
  const n = q.getAll('via').length + 1; // sections
  const sections = Array.from({ length: n }, () => ({ summary: { length: bus ? 30000 : 24000, duration: bus ? 2400 : 1800 } }));
  return json({ routes: [{ sections }] });
};
const { routeEstimate } = await import('../src/integrations.js');
const { planTimes, isBusCategory } = await import('../src/itinerary.js');
const stops = [{ address: 'A St', lat: 40.7, lng: -74, time: '2099-06-01T07:00' }, { address: 'B St' }, { address: 'C St', wait_min: 10 }];
const r = await routeEstimate(stops, { bus: true });
assert.equal(r.bus_aware, true); assert.equal(r.mode, 'bus'); assert.equal(r.legs.length, 2);
assert.equal(r.minutes, 80); assert.equal(r.car.minutes, 60); assert.equal(r.car.extra_minutes, 20); assert.ok(r.car.extra_miles > 0);
const busCall = calls.find((c) => c.includes('transportMode=privateBus')); assert.ok(busCall.includes('vehicle%5Bheight%5D=370')); assert.ok(calls.some((c) => c.includes('transportMode=car')));
assert.ok(calls.some((c) => c.includes('geocode.search.hereapi.com')), 'geocodes stops that have no coordinates');
const t = planTimes(stops, r.legs); assert.equal(t[1].arrive, '2099-06-01T07:40'); assert.equal(t[2].arrive, '2099-06-01T08:20'); assert.equal(t[2].depart, '2099-06-01T08:30');
const c = await routeEstimate(stops, { bus: false }); assert.equal(c.mode, 'car'); assert.equal(c.bus_aware, false); assert.equal(c.car, undefined);
assert.equal(isBusCategory('Limo'), false); assert.equal(isBusCategory('Coach Bus'), true); assert.equal(isBusCategory('Sprinter / Shuttle'), false);
console.log('Route checks passed.');
