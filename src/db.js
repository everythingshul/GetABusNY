import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'getabusny.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, pass_hash TEXT NOT NULL, role TEXT DEFAULT 'admin', created_at TEXT);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT, address TEXT, notes TEXT, tags TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_cust_email ON customers(email);
CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, capacity INTEGER, description TEXT, features TEXT, image TEXT, hourly_cents INTEGER DEFAULT 0, min_hours INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 100, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS drivers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, vendor_id INTEGER, token TEXT UNIQUE, active INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS vendors(id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_name TEXT, email TEXT, phone TEXT, vehicle_types TEXT, service_area TEXT, rating INTEGER DEFAULT 0, notes TEXT, active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, ref TEXT UNIQUE, customer_id INTEGER, name TEXT, email TEXT, phone TEXT, details TEXT, status TEXT DEFAULT 'new', source TEXT, referred_by TEXT, notes TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY, number TEXT UNIQUE, customer_id INTEGER, request_id INTEGER, status TEXT DEFAULT 'draft', title TEXT, items TEXT DEFAULT '[]', tax_rate REAL DEFAULT 0, deposit_pct REAL DEFAULT 50, subtotal_cents INTEGER DEFAULT 0, tax_cents INTEGER DEFAULT 0, total_cents INTEGER DEFAULT 0, valid_until TEXT, notes TEXT, trip TEXT DEFAULT '{}', token TEXT UNIQUE, sent_at TEXT, viewed_at TEXT, accepted_at TEXT, declined_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS trips(id INTEGER PRIMARY KEY, ref TEXT UNIQUE, customer_id INTEGER, quote_id INTEGER, status TEXT DEFAULT 'booked', title TEXT, pickup TEXT, dropoff TEXT, stops TEXT, depart_at TEXT, return_at TEXT, passengers INTEGER, vehicle_id INTEGER, vendor_id INTEGER, vendor_cost_cents INTEGER DEFAULT 0, driver_id INTEGER, price_cents INTEGER DEFAULT 0, onsite_name TEXT, onsite_phone TEXT, notes TEXT, driver_notes TEXT, driver_status TEXT, driver_status_at TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_trips_depart ON trips(depart_at);
CREATE TABLE IF NOT EXISTS trip_events(id INTEGER PRIMARY KEY, trip_id INTEGER, status TEXT, note TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, number TEXT UNIQUE, customer_id INTEGER, trip_id INTEGER, quote_id INTEGER, status TEXT DEFAULT 'draft', title TEXT, items TEXT DEFAULT '[]', tax_rate REAL DEFAULT 0, subtotal_cents INTEGER DEFAULT 0, tax_cents INTEGER DEFAULT 0, total_cents INTEGER DEFAULT 0, deposit_cents INTEGER DEFAULT 0, amount_paid_cents INTEGER DEFAULT 0, due_date TEXT, notes TEXT, token TEXT UNIQUE, sent_at TEXT, paid_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, invoice_id INTEGER, amount_cents INTEGER, method TEXT, reference TEXT, stripe_session TEXT UNIQUE, stripe_pi TEXT, status TEXT DEFAULT 'succeeded', note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS rfqs(id INTEGER PRIMARY KEY, ref TEXT UNIQUE, request_id INTEGER, trip_id INTEGER, vendor_id INTEGER, token TEXT UNIQUE, status TEXT DEFAULT 'sent', message TEXT, snapshot TEXT, price_cents INTEGER, offered_vehicle TEXT, response_notes TEXT, sent_at TEXT, responded_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS followups(id INTEGER PRIMARY KEY, entity_type TEXT, entity_id INTEGER, kind TEXT, channel TEXT DEFAULT 'email', to_email TEXT, subject TEXT, body TEXT, due_at TEXT, status TEXT DEFAULT 'pending', auto INTEGER DEFAULT 0, result TEXT, created_at TEXT, done_at TEXT);
CREATE INDEX IF NOT EXISTS idx_fu_due ON followups(status, due_at);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, subject TEXT, body TEXT, status TEXT DEFAULT 'new', created_at TEXT);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, to_addr TEXT, subject TEXT, html TEXT, status TEXT, error TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS bot_sessions(id TEXT PRIMARY KEY, scope TEXT, messages TEXT DEFAULT '[]', updated_at TEXT);
`);

export const now = () => new Date().toISOString();
db.exec(`CREATE TABLE IF NOT EXISTS sms_log(id INTEGER PRIMARY KEY, to_phone TEXT, body TEXT, kind TEXT, status TEXT, error TEXT, customer_id INTEGER, trip_id INTEGER, send_after TEXT, created_at TEXT, sent_at TEXT)`);

// ---- additive migrations (safe to run every boot) ----
function addCol(table, col, def) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('users', 'phone', 'TEXT');
addCol('users', 'notify_prefs', 'TEXT');
addCol('customers', 'sms_types', 'TEXT');
addCol('sms_log', 'direction', "TEXT DEFAULT 'out'");
addCol('sms_log', 'provider_id', 'TEXT');
addCol('outbox', 'kind', 'TEXT');
addCol('outbox', 'from_addr', 'TEXT');
addCol('outbox', 'provider', 'TEXT');
addCol('outbox', 'attachments', 'TEXT');
addCol('trips', 'itinerary', "TEXT DEFAULT '[]'");
addCol('trips', 'purpose', 'TEXT');
addCol('trips', 'review_sent_at', 'TEXT');
addCol('customers', 'sms_optin', 'INTEGER DEFAULT 0');
addCol('customers', 'sms_optin_at', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS contracts(id INTEGER PRIMARY KEY, number TEXT UNIQUE, trip_id INTEGER, quote_id INTEGER, customer_id INTEGER, token TEXT UNIQUE, status TEXT DEFAULT 'sent', body TEXT, body_hash TEXT, total_cents INTEGER, signer_name TEXT, signer_email TEXT, signature TEXT, signed_at TEXT, signer_ip TEXT, signer_ua TEXT, pdf_file TEXT, sent_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS page_views(id INTEGER PRIMARY KEY, at TEXT, day TEXT, path TEXT, ref TEXT, sid TEXT, device TEXT, country TEXT);
CREATE INDEX IF NOT EXISTS idx_pv_day ON page_views(day);
CREATE TABLE IF NOT EXISTS sms_log(id INTEGER PRIMARY KEY, to_phone TEXT, body TEXT, kind TEXT, status TEXT, error TEXT, customer_id INTEGER, trip_id INTEGER, send_after TEXT, created_at TEXT, sent_at TEXT);
CREATE INDEX IF NOT EXISTS idx_sms_q ON sms_log(status, send_after);
`);
export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

/** Insert a row from an object (only given keys). Returns new id. */
export function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => norm(obj[k])));
  return Number(r.lastInsertRowid);
}
export function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => norm(obj[k])), id);
}
const norm = (v) => (v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : typeof v === 'boolean' ? +v : v);

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  business_name: 'Get A Bus NY',
  phone: '+1-413-438-2287',
  email: 'getabusny@gmail.com',
  address: '',
  service_area: 'New York and the surrounding region',
  hours: JSON.stringify([
    { day: 'Sunday', open: '10:00 AM', close: '7:00 PM' },
    { day: 'Monday', open: '10:00 AM', close: '7:00 PM' },
    { day: 'Tuesday', open: '10:00 AM', close: '7:00 PM' },
    { day: 'Wednesday', open: '10:00 AM', close: '7:00 PM' },
    { day: 'Thursday', open: '10:00 AM', close: '7:00 PM' },
    { day: 'Friday', open: '10:00 AM', close: '12:30 PM' },
    { day: 'Saturday', open: '', close: '' },
  ]),
  socials: JSON.stringify({ twitter: 'https://twitter.com/getabusny', facebook: 'https://www.facebook.com/isaac.newman.731', instagram: '', tiktok: '', youtube: '', google: '' }),
  tax_rate: '0',
  deposit_pct: '50',
  quote_valid_days: '7',
  invoice_due_days: '7',
  timezone: 'America/New_York',
  email_from: '',
  notify_email: '',
  // follow-up automation (days; empty = off)
  fu_quote_days: '2,5,10',
  fu_invoice_before_days: '3',
  fu_invoice_after_days: '3,7,14',
  fu_trip_confirm_hours: '24',
  fu_trip_thanks_days: '1',
  fu_rfq_hours: '24',
  fu_enabled: '1',
  driver_window_before_hrs: '24',
  driver_window_after_hrs: '12',
  chesky_public: '1',
  chesky_name: 'Chesky',
  chesky_extra: '',
  // v2
  google_review_url: '',
  sms_own_number: '',
  bus_height_cm: '370',
  bus_width_cm: '260',
  bus_length_cm: '1370',
  bus_weight_kg: '18000',
  sms_enabled: '1',
  sms_quiet_start: 'Fri 14:00',
  sms_quiet_end: 'Sat 21:30',
  sms_auto_reminder_hours: '24',
  cal_token: '',
  require_signature: '1',
  trip_purposes: 'Camp trip,Shabbaton,Kehila trip,Kivrei Tzadikim,Yeshiva / school trip,Chasunah / simcha,Chol Hamoed trip,Airport / transfer,Other',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);

export const getSetting = (k) => one('SELECT value FROM settings WHERE key=?', k)?.value ?? DEFAULT_SETTINGS[k] ?? '';
export const getJSON = (k, d) => { try { return JSON.parse(getSetting(k)); } catch { return d; } };
export const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
export const allSettings = () => Object.fromEntries(all('SELECT key,value FROM settings').map((r) => [r.key, r.value]));

export function nextNumber(prefix, start = 1001) {
  const key = `seq_${prefix}`;
  const cur = Number(one('SELECT value FROM settings WHERE key=?', key)?.value || start - 1) + 1;
  setSetting(key, cur);
  return `${prefix}-${cur}`;
}

export function log(actor, action, entity_type, entity_id, detail = '') {
  run('INSERT INTO activity(at,actor,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?,?)', now(), actor || 'system', action, entity_type, entity_id ?? null, String(detail).slice(0, 500));
}

// ---------- money ----------
export function totals(items, taxRate = 0) {
  const subtotal = (items || []).reduce((s, i) => s + Math.round((Number(i.qty) || 0) * (Number(i.unit_cents) || 0)), 0);
  const tax = Math.round((subtotal * (Number(taxRate) || 0)) / 100);
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}
export const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- seed fleet (from the existing site) ----------
if (!getSetting('cal_token')) setSetting('cal_token', crypto.randomBytes(18).toString('base64url'));

if (!one('SELECT 1 x FROM vehicles LIMIT 1')) {
  const seed = [
    ['56 Seater Coach Bus', 'Coach Bus', 56, 'Full-size motorcoach for long-distance trips, school and church groups, tours and corporate travel.', 'Restroom (select units),Reclining seats,Overhead storage,Luggage bay,A/C,PA system'],
    ['50 Seater Setra Party Bus', 'Party Bus', 50, 'Large Setra party coach with a lounge feel for big nights out and group celebrations.', 'LED lighting,Sound system,Dance floor,Wet bar,A/C'],
    ['45 Seater Freightliner Party Bus', 'Party Bus', 45, 'Freightliner party bus with perimeter seating and an open floor.', 'LED lighting,Sound system,Dance floor,A/C'],
    ['37 Seater Freightliner Party Bus', 'Party Bus', 37, 'Mid-size party bus that fits most weddings, proms and birthdays.', 'LED lighting,Sound system,Dance floor,A/C'],
    ['34 Seater Party Bus (Unit 696)', 'Party Bus', 34, 'Party bus for medium groups.', 'LED lighting,Sound system,A/C'],
    ['34 Seater Party Bus (Unit 699)', 'Party Bus', 34, 'Party bus for medium groups.', 'LED lighting,Sound system,A/C'],
    ['33 Seater Ford F550 Party Bus', 'Party Bus', 33, 'Ford F550 party bus that is easier to park and maneuver in the city.', 'LED lighting,Sound system,A/C'],
    ['40 Seater Mardi Gras Trolley', 'Trolley', 40, 'Open, classic trolley styling. Popular for weddings and wine tours.', 'Wood-look interior,Sound system,A/C'],
    ['30 Seater Trolley (White)', 'Trolley', 30, 'White trolley for weddings, tours and downtown shuttles.', 'Sound system,A/C'],
    ['34 Seater Dolly Trolley', 'Trolley', 34, 'Dolly-style trolley for tours, weddings and events.', 'Sound system,A/C'],
    ['26 Seater Transformer Hummer', 'Limo', 26, 'Hummer stretch limo with a full party interior.', 'Fiber-optic lighting,Sound system,Bar area'],
  ];
  seed.forEach(([name, category, capacity, description, features], i) => insert('vehicles', { name, category, capacity, description, features, active: 1, sort: (i + 1) * 10, created_at: now(), updated_at: now() }));
}
