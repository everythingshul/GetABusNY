// Zmanim and Shabbos / Yom Tov awareness (Hebcal, runs offline). Used by the admin schedule checks and by the text-message quiet window.
import { Location, Zmanim, HebrewCalendar, flags } from '@hebcal/core';
import { getSetting } from './db.js';

const DEFAULT = { lat: 40.7128, lng: -74.006 };
const tzid = () => getSetting('timezone') || 'America/New_York';
const loc = (lat, lng) => new Location(Number(lat) || DEFAULT.lat, Number(lng) || DEFAULT.lng, false, tzid(), 'Trip', 'US', '', 10);
const candleMins = () => Number(getSetting('candle_mins')) || 18;
const havdalahMins = () => Number(getSetting('havdalah_mins')) || 50;

const timeStr = (d) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: tzid(), hour: 'numeric', minute: '2-digit' }).format(d) : null);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tzid(), month: 'long', day: 'numeric', year: 'numeric' }).format(d);

/** Real instants for a "naive" local date-time in the business timezone. */
function naiveToDate(naive) {
  const s = naive.length === 10 ? naive + 'T12:00' : naive.slice(0, 16);
  const guess = new Date(s + ':00Z');
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tzid(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(guess).map((x) => [x.type, x.value]));
  return new Date(guess.getTime() - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess.getTime()));
}

const cache = new Map();
/** Windows when it is Shabbos or Yom Tov: from candle lighting to havdalah (a run of days counts as one window). */
export function windows(fromDate, toDate, lat, lng) {
  const key = `${fromDate.toISOString().slice(0, 10)}|${toDate.toISOString().slice(0, 10)}|${lat}|${lng}|${candleMins()}|${havdalahMins()}`;
  if (cache.has(key)) return cache.get(key);
  const start = new Date(fromDate.getTime() - 3 * 86400000), end = new Date(toDate.getTime() + 3 * 86400000);
  const ev = HebrewCalendar.calendar({ start, end, location: loc(lat, lng), candlelighting: true, havdalahMins: havdalahMins(), candleLightingMins: -candleMins(), sedrot: false, noHolidays: false });
  const timed = ev.filter((e) => e.eventTime && /^(Candle lighting|Havdalah)/.test(e.render('en'))).map((e) => ({ t: e.eventTime, cl: /^Candle/.test(e.render('en')) })).sort((a, b) => a.t - b.t);
  const out = []; let open = null;
  for (const e of timed) {
    if (e.cl && !open) open = e.t;
    else if (!e.cl && open) { out.push({ start: open, end: e.t }); open = null; }
  }
  cache.set(key, out); if (cache.size > 200) cache.clear();
  return out;
}
export const inWindow = (instant, lat, lng) => windows(instant, instant, lat, lng).find((w) => instant >= w.start && instant < w.end) || null;

/** Is "now" inside Shabbos or Yom Tov? Returns the end of that window or null. */
export function quietUntil(now = new Date()) {
  try { const w = inWindow(now); return w ? w.end : null; } catch { return null; }
}

/** Everything useful about one calendar day (YYYY-MM-DD). */
export function dayInfo(dateStr, lat, lng) {
  const noon = naiveToDate(dateStr + 'T12:00');
  const l = loc(lat, lng);
  const z = new Zmanim(l, noon, false);
  const names = HebrewCalendar.calendar({ start: noon, end: noon, location: l, candlelighting: false, sedrot: true, il: false })
    .filter((e) => !(e.getFlags() & (flags.CHAG === 0 ? 0 : 0)) || true).map((e) => e.render('en')).filter((n) => !/^(Candle|Havdalah)/.test(n));
  const w = windows(noon, noon, lat, lng);
  const dayStart = naiveToDate(dateStr + 'T00:00'), dayEnd = naiveToDate(dateStr + 'T23:59');
  const cl = w.find((x) => x.start >= dayStart && x.start <= dayEnd), hv = w.find((x) => x.end >= dayStart && x.end <= dayEnd);
  const sunset = z.sunset();
  const sunsetDate = sunset;
  return {
    date: dateStr, date_long: longDate(noon), weekday: new Intl.DateTimeFormat('en-US', { timeZone: tzid(), weekday: 'long' }).format(noon),
    holidays: names,
    sunrise: timeStr(z.sunrise()), sof_zman_shma: timeStr(z.sofZmanShma()), chatzot: timeStr(z.chatzot()), sunset: timeStr(sunsetDate), tzeit: timeStr(z.tzeit()),
    candle_lighting: cl ? timeStr(cl.start) : null, havdalah: hv ? timeStr(hv.end) : null,
    in_window_at_noon: !!inWindow(noon, lat, lng),
    shabbos_or_yomtov_day: !!(w.find((x) => x.start < dayEnd && x.end > dayStart)),
  };
}

/** Check a trip's times. Returns [{level:'red'|'amber', text}]. */
export function scheduleCheck({ stops = [], depart_at, return_at, lat, lng }) {
  const issues = [];
  const times = [];
  if (depart_at) times.push({ label: 'Departure', t: depart_at });
  if (return_at) times.push({ label: 'Return', t: return_at });
  stops.forEach((s, i) => { if (s.time) times.push({ label: `Stop ${i + 1}`, t: s.time }); });
  const seen = new Set();
  for (const x of times) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x.t)) continue;
    const at = naiveToDate(x.t);
    const w = inWindow(at, lat, lng);
    if (w) {
      const k = `${x.label}`; if (seen.has(k)) continue; seen.add(k);
      issues.push({ level: 'red', text: `${x.label} (${longDate(at)}, ${timeStr(at)}) falls on Shabbos or Yom Tov. It lasts from ${longDate(w.start)}, ${timeStr(w.start)} to ${longDate(w.end)}, ${timeStr(w.end)}.` });
    }
  }
  // close calls before candle lighting (timed events inside the 90 minutes before a window)
  for (const x of times) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x.t)) continue;
    const at = naiveToDate(x.t);
    const next = windows(at, new Date(at.getTime() + 86400000), lat, lng).find((w) => w.start > at && w.start - at < 90 * 60000);
    if (next && !inWindow(at, lat, lng)) issues.push({ level: 'amber', text: `${x.label} is ${Math.round((next.start - at) / 60000)} minutes before candle lighting (${timeStr(next.start)}). Leave margin for traffic.` });
  }
  return issues;
}
