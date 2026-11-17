// Analytics for any date range (business time zone): website traffic and the business side, with the previous period for comparison.
import { all, one, localDate, localStart, tzName } from './db.js';

const OK = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));
const addDay = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const ms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const span = (a, b) => Math.round((ms(b) - ms(a)) / 864e5) + 1;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (s) => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
const monLabel = (s) => `${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const weekStart = (s) => { const [y, m, d] = s.split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDay(s, -((dow + 6) % 7)); }; // Monday

/** Bucket size for a range, so charts stay readable. */
function plan(from, to) {
  const n = span(from, to);
  const unit = n <= 62 ? 'day' : n <= 400 ? 'week' : 'month';
  const key = (s) => (unit === 'day' ? s : unit === 'week' ? weekStart(s) : s.slice(0, 7));
  const label = (k) => (unit === 'month' ? monLabel(k + '-01') : dayLabel(k));
  const keys = []; const seen = new Set();
  for (let i = 0; i < n; i++) { const k = key(addDay(from, i)); if (!seen.has(k)) { seen.add(k); keys.push(k); } }
  return { unit, key, label, keys, n };
}

function windowStats(from, to) {
  const a = localStart(from).toISOString(), b = localStart(addDay(to, 1)).toISOString();
  const pv = one('SELECT COUNT(*) views, COUNT(DISTINCT sid) visitors FROM page_views WHERE day>=? AND day<=?', from, to);
  const leads = one('SELECT COUNT(*) c FROM requests WHERE created_at>=? AND created_at<?', a, b).c;
  const q = one("SELECT COUNT(*) n, COALESCE(AVG(total_cents),0) avg FROM quotes WHERE sent_at>=? AND sent_at<?", a, b);
  const accepted = one('SELECT COUNT(*) c FROM quotes WHERE accepted_at>=? AND accepted_at<?', a, b).c;
  const rev = one("SELECT COALESCE(SUM(amount_cents),0) c, COUNT(DISTINCT invoice_id) inv FROM payments WHERE status='succeeded' AND created_at>=? AND created_at<?", a, b);
  return {
    views: pv.views, visitors: pv.visitors, leads, quotes_sent: q.n, avg_quote_cents: Math.round(q.avg), accepted, revenue_cents: rev.c, paid_invoices: rev.inv,
    new_customers: one('SELECT COUNT(*) c FROM customers WHERE created_at>=? AND created_at<?', a, b).c,
    trips_booked: one("SELECT COUNT(*) c FROM trips WHERE created_at>=? AND created_at<? AND status<>'cancelled'", a, b).c,
    win_rate: q.n ? accepted / q.n : 0,
  };
}

export function analyticsRange({ from, to } = {}) {
  const today = localDate();
  let all_time = false;
  if (from === 'all' || to === 'all' || !OK(from) || !OK(to)) {
    all_time = from === 'all' || to === 'all';
    if (all_time) {
      const firsts = [one('SELECT MIN(day) d FROM page_views').d, one('SELECT MIN(created_at) d FROM requests').d && localDate(new Date(one('SELECT MIN(created_at) d FROM requests').d)), one('SELECT MIN(created_at) d FROM payments').d && localDate(new Date(one('SELECT MIN(created_at) d FROM payments').d))].filter(Boolean).sort();
      from = firsts[0] || today; to = today;
    } else { to = today; from = addDay(today, -29); }
  }
  if (from > to) [from, to] = [to, from];
  if (span(from, to) > 3660) from = addDay(to, -3659);
  const n = span(from, to);
  const cur = windowStats(from, to);
  const prevTo = addDay(from, -1), prevFrom = addDay(prevTo, -(n - 1));
  const prev = all_time ? null : windowStats(prevFrom, prevTo);
  const pl = plan(from, to);
  const a = localStart(from).toISOString(), b = localStart(addDay(to, 1)).toISOString();

  // series
  const ser = new Map(pl.keys.map((k) => [k, { k, label: pl.label(k), views: 0, visitors: 0, leads: 0, revenue_cents: 0, _s: new Set() }]));
  for (const r of all('SELECT day, sid FROM page_views WHERE day>=? AND day<=?', from, to)) { const s = ser.get(pl.key(r.day)); if (s) { s.views++; s._s.add(r.sid); } }
  for (const r of all('SELECT created_at FROM requests WHERE created_at>=? AND created_at<?', a, b)) { const s = ser.get(pl.key(localDate(new Date(r.created_at)))); if (s) s.leads++; }
  for (const r of all("SELECT created_at, amount_cents FROM payments WHERE status='succeeded' AND created_at>=? AND created_at<?", a, b)) { const s = ser.get(pl.key(localDate(new Date(r.created_at)))); if (s) s.revenue_cents += r.amount_cents; }
  const series = [...ser.values()].map(({ _s, ...x }) => ({ ...x, visitors: _s.size }));

  // lists
  const pages = all('SELECT path k, COUNT(*) c FROM page_views WHERE day>=? AND day<=? GROUP BY path ORDER BY c DESC LIMIT 10', from, to);
  const refs = all("SELECT CASE WHEN ref='' THEN '(direct)' ELSE ref END k, COUNT(DISTINCT sid) c FROM page_views WHERE day>=? AND day<=? GROUP BY k ORDER BY c DESC LIMIT 8", from, to);
  const devices = all('SELECT device k, COUNT(DISTINCT sid) c FROM page_views WHERE day>=? AND day<=? GROUP BY device ORDER BY c DESC', from, to);
  const sources = all("SELECT COALESCE(source,'unknown') k, COUNT(*) c FROM requests WHERE created_at>=? AND created_at<? GROUP BY k ORDER BY c DESC", a, b);
  const purposeMap = {}; for (const r of all('SELECT details FROM requests WHERE created_at>=? AND created_at<?', a, b)) { let p = ''; try { p = JSON.parse(r.details || '{}').purpose || ''; } catch { /* none */ } if (p) purposeMap[p] = (purposeMap[p] || 0) + 1; }
  const purposes = Object.entries(purposeMap).map(([k, c]) => ({ k, c })).sort((x, y) => y.c - x.c).slice(0, 8);
  const topVehicles = all("SELECT v.name k, COUNT(*) c, COALESCE(SUM(t.price_cents),0) rev FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.created_at>=? AND t.created_at<? AND t.status<>'cancelled' GROUP BY v.id ORDER BY c DESC LIMIT 8", a, b);
  const topCustomers = all("SELECT c.id, c.name k, COUNT(*) c, COALESCE(SUM(t.price_cents),0) rev FROM trips t JOIN customers c ON c.id=t.customer_id WHERE t.created_at>=? AND t.created_at<? AND t.status<>'cancelled' GROUP BY c.id ORDER BY rev DESC LIMIT 8", a, b);
  const gratuity = { total: one("SELECT COALESCE(SUM(gratuity_cents),0) s FROM invoices WHERE status='paid' AND updated_at>=? AND updated_at<?", a, b).s, byDriver: all("SELECT COALESCE(d.name,'No driver assigned') k, SUM(i.gratuity_cents) c FROM invoices i LEFT JOIN trips t ON t.id=i.trip_id LEFT JOIN drivers d ON d.id=t.driver_id WHERE i.status='paid' AND i.gratuity_cents>0 AND i.updated_at>=? AND i.updated_at<? GROUP BY d.id ORDER BY c DESC LIMIT 8", a, b) };
  const messages = { emails: one("SELECT COUNT(*) c FROM outbox WHERE created_at>=? AND created_at<? AND status<>'failed'", a, b).c, texts_out: one("SELECT COUNT(*) c FROM sms_log WHERE direction='out' AND created_at>=? AND created_at<?", a, b).c, texts_in: one("SELECT COUNT(*) c FROM sms_log WHERE direction='in' AND created_at>=? AND created_at<?", a, b).c };
  const t0 = localDate();
  const ar = one("SELECT COALESCE(SUM(total_cents-amount_paid_cents),0) open, COALESCE(SUM(CASE WHEN due_date<? THEN total_cents-amount_paid_cents ELSE 0 END),0) overdue FROM invoices WHERE status IN ('sent','partial')", t0);

  return {
    range: { from, to, days: n, unit: pl.unit, all_time, tz: tzName(), prev: all_time ? null : { from: prevFrom, to: prevTo } },
    cur, prev, series, pages, refs, devices, sources, purposes, topVehicles, topCustomers, gratuity, messages, ar,
    funnel: { visitors: cur.visitors, leads: cur.leads, quotes_sent: cur.quotes_sent, accepted: cur.accepted, paid: cur.paid_invoices },
  };
}
