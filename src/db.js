import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
/** While a test send runs, writes are skipped and emails/texts go to the business email only. */
export const testCtx = new AsyncLocalStorage();
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
addCol('vendors', 'insurance_carrier', 'TEXT');
addCol('vendors', 'insurance_policy', 'TEXT');
addCol('vendors', 'insurance_expires', 'TEXT');
addCol('vendors', 'dot_number', 'TEXT');
addCol('vendors', 'mc_number', 'TEXT');
addCol('vendors', 'coi_file', 'TEXT');
addCol('vendors', 'fmcsa_checked_at', 'TEXT');
addCol('vendors', 'fmcsa_status', 'TEXT');
addCol('vendors', 'insurance_verified_at', 'TEXT');
addCol('vendors', 'insurance_verified_by', 'TEXT');
addCol('vendors', 'insurance_verify_note', 'TEXT');
addCol('quotes', 'revision', 'INTEGER DEFAULT 1');
addCol('requests', 'original_details', 'TEXT'); for (const t of ['quotes', 'invoices']) { addCol(t, 'cc_fee_on', 'INTEGER DEFAULT 0'); addCol(t, 'cc_fee_pct', 'REAL DEFAULT 0'); addCol(t, 'cc_fee_flat_cents', 'INTEGER DEFAULT 0'); } addCol('payments', 'fee_cents', 'INTEGER DEFAULT 0'); addCol('trips', 'driver_token', 'TEXT'); db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_driver_token ON trips(driver_token) WHERE driver_token IS NOT NULL'); addCol('quotes', 'pay_full', 'INTEGER DEFAULT 0'); addCol('invoices', 'pay_full', 'INTEGER DEFAULT 0'); addCol('quotes', 'sig_waived', 'INTEGER DEFAULT 0'); addCol('rfqs', 'closed_by', 'INTEGER'); addCol('rfqs', 'awarded_at', 'TEXT'); addCol('requests', 'seq', 'INTEGER'); addCol('quotes', 'seq', 'INTEGER'); addCol('invoices', 'seq', 'INTEGER'); addCol('trips', 'seq', 'INTEGER'); addCol('rfqs', 'seq', 'INTEGER');
for (const t of ['requests', 'quotes', 'invoices', 'trips', 'rfqs']) db.exec(`UPDATE ${t} SET seq=id WHERE seq IS NULL`);
db.exec(`CREATE TABLE IF NOT EXISTS quote_revisions(id INTEGER PRIMARY KEY, quote_id INTEGER, revision INTEGER, changed_at TEXT, changed_by TEXT, reason TEXT, changes TEXT, total_before INTEGER, total_after INTEGER, snapshot TEXT, sent_at TEXT)`);
addCol('invoices', 'gratuity_cents', 'INTEGER DEFAULT 0');
for (const c of ['stripe_customer_id', 'card_pm', 'card_brand', 'card_last4', 'card_exp', 'card_consent_at', 'card_consent_text']) addCol('customers', c, 'TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS banner_images(id INTEGER PRIMARY KEY, file TEXT, mime TEXT, name TEXT, sort INTEGER DEFAULT 100, active INTEGER DEFAULT 1, created_at TEXT)`);
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
addCol('customers', 'sms_stop_at', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS contracts(id INTEGER PRIMARY KEY, number TEXT UNIQUE, trip_id INTEGER, quote_id INTEGER, customer_id INTEGER, token TEXT UNIQUE, status TEXT DEFAULT 'sent', body TEXT, body_hash TEXT, total_cents INTEGER, signer_name TEXT, signer_email TEXT, signature TEXT, signed_at TEXT, signer_ip TEXT, signer_ua TEXT, pdf_file TEXT, sent_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS page_views(id INTEGER PRIMARY KEY, at TEXT, day TEXT, path TEXT, ref TEXT, sid TEXT, device TEXT, country TEXT);
CREATE INDEX IF NOT EXISTS idx_pv_day ON page_views(day);
CREATE TABLE IF NOT EXISTS sms_log(id INTEGER PRIMARY KEY, to_phone TEXT, body TEXT, kind TEXT, status TEXT, error TEXT, customer_id INTEGER, trip_id INTEGER, send_after TEXT, created_at TEXT, sent_at TEXT);
CREATE INDEX IF NOT EXISTS idx_sms_q ON sms_log(status, send_after);
`);
addCol('vehicles', 'images', 'TEXT'); addCol('vehicles', 'operator_url', 'TEXT'); addCol('vehicles', 'internal_pricing', 'TEXT'); addCol('vehicles', 'internal_notes', 'TEXT'); db.exec("UPDATE vehicles SET images=json_array(image) WHERE images IS NULL AND image IS NOT NULL AND image<>''");
addCol('contracts', 'seq', 'INTEGER'); db.exec('UPDATE contracts SET seq=id WHERE seq IS NULL');

// The business ledger: every dollar in and out. Rows with src='payment' mirror the payments table; the rest are typed in.
db.exec(`CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, date TEXT, direction TEXT, amount_cents INTEGER, vendor TEXT, invoice_ref TEXT, description TEXT, paid_with TEXT, account TEXT, notes TEXT, maaser_cents INTEGER DEFAULT 0, category TEXT,
  src TEXT, src_id INTEGER, invoice_id INTEGER, customer_id INTEGER, trip_id INTEGER, vendor_id INTEGER, file TEXT, file_name TEXT, file_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_src ON ledger(src, src_id) WHERE src IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date);`);
db.exec(`CREATE TABLE IF NOT EXISTS labels(id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#e7e7e7', parent_id INTEGER, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS label_links(label_id INTEGER, entity_type TEXT, entity_id INTEGER, PRIMARY KEY(label_id, entity_type, entity_id));
CREATE INDEX IF NOT EXISTS idx_label_links_entity ON label_links(entity_type, entity_id);`);
db.exec(`CREATE TABLE IF NOT EXISTS trash(id INTEGER PRIMARY KEY, entity TEXT, entity_id INTEGER, title TEXT, sub TEXT, seq INTEGER, data TEXT, children TEXT, deleted_by TEXT, deleted_at TEXT, restored_at TEXT, restored_by TEXT); CREATE INDEX IF NOT EXISTS idx_trash_entity ON trash(entity, seq);`);
addCol('ledger', 'maaser_given', 'INTEGER DEFAULT 0'); addCol('ledger', 'maaser_given_at', 'TEXT'); addCol('ledger', 'maaser_of', 'INTEGER');
// maaser is a fixed 10% of money in
db.exec("UPDATE ledger SET maaser_cents=CAST(ROUND(amount_cents*0.1) AS INTEGER) WHERE direction='in' AND maaser_cents IS NOT (CAST(ROUND(amount_cents*0.1) AS INTEGER)); UPDATE ledger SET maaser_cents=0 WHERE direction='out' AND maaser_cents<>0");
export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
const NO_WRITE = { changes: 0, lastInsertRowid: 0 };
export const run = (sql, ...p) => (testCtx.getStore() && !/^\s*(SELECT|PRAGMA)/i.test(sql) ? NO_WRITE : db.prepare(sql).run(...p));
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
  banner_seconds: '6',
  ledger_accounts: 'Stripe,Business checking,Cash,Business credit card',
  ledger_paid_with: 'Credit card,Check,Cash,Zelle,ACH / bank transfer,Wire',
  ledger_categories: 'Sales,Refunds,Vendor and operator payments,Fuel,Tolls and parking,Driver pay,Insurance,Repairs and maintenance,Office and software,Marketing,Payroll,Taxes,Maaser,Other',
  sms_quiet_mode: 'zmanim',
  candle_mins: '18',
  havdalah_mins: '50',
  sms_groups_on: 'quotes,payments,reminders,driver,reviews',
  bus_height_cm: '370',
  bus_width_cm: '260',
  bus_length_cm: '1370',
  bus_weight_kg: '18000',
  sms_enabled: '1',
  driver_auto_text: '1',
  sms_quiet_start: 'Fri 14:00',
  sms_quiet_end: 'Sat 21:30',
  sms_auto_reminder_hours: '24',
  cal_token: '',
  require_signature: '1',
  cc_fee_pct: '3',
  cc_fee_flat: '0.30',
  trip_purposes: 'Camp trip,Shabbaton,Kehila trip,Kivrei Tzadikim,Yeshiva / school trip,Wedding / simcha,Chol Hamoed trip,Airport / transfer,Other',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);

export const getSetting = (k) => one('SELECT value FROM settings WHERE key=?', k)?.value ?? DEFAULT_SETTINGS[k] ?? '';
export const getJSON = (k, d) => { try { return JSON.parse(getSetting(k)); } catch { return d; } };
export const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
export const allSettings = () => Object.fromEntries(all('SELECT key,value FROM settings').map((r) => [r.key, r.value]));

/** Customer-facing reference: a random number that reveals nothing about volume, e.g. Q-482931. */
export function randomRef(prefix, table, col) {
  for (let i = 0; i < 50; i++) {
    const ref = `${prefix}-${crypto.randomInt(100000, 1000000)}`;
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(ref)) return ref;
  }
  return `${prefix}-${Date.now()}`;
}
/** Internal consecutive number shown only in the admin. */
// Numbers are never reused: the highest number ever issued counts, including anything in the trash.
export const nextSeq = (table) => Math.max(db.prepare(`SELECT COALESCE(MAX(seq),0) n FROM ${table}`).get().n, db.prepare('SELECT COALESCE(MAX(seq),0) n FROM trash WHERE entity=?').get(table).n) + 1;

/** The business time zone (Settings). All "today", due dates and daily reports use it, never the server's UTC clock. */
export const tzName = () => getSetting('timezone') || 'America/New_York';
/** YYYY-MM-DD for a moment, as the calendar reads in the business time zone. */
export function localDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tzName(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** The moment a calendar day begins (00:00) in the business time zone, as a Date. */
export function localStart(dateStr) {
  const [y, m, dd] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, dd, 0, 0, 0));
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tzName(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(guess).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}
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
  // Names, seats and amenities come from the old fleet pages (fleet-getabusny.blogspot.com). Edit them in the admin.
  const seed = [
    ['56 Seater Coach Bus', 'Coach Bus', 56, 'Coach seating 56 with Wi-Fi, outlets and underbelly storage for luggage.', 'Wi-Fi,Outlets,DVD,Underbelly storage'],
    ['50 Seater Setra Party Bus', 'Party Bus', 50, 'Mercedes-styled Setra party coach with a white diamond-stitched interior, two booths and a restroom.', 'Mercedes styling,USB and charging stations,2 large flat TVs,Chrome and white ceiling,RGB and fiber optic lighting,White interior with diamond stitching,High end sound system,Coolers,Two booths,Wi-Fi,Restroom'],
    ['45 Seater Freightliner Party Bus', 'Party Bus', 45, 'Freightliner party bus with couch seating, two bars and a restroom.', 'Couch seating,Wood floor,Chrome ceiling,Two bars,Fiber optic lighting,RGB lighting,Two large TVs (front and back wall),Level 5 sound system,Bluetooth,Removable pole,Bathroom'],
    ['37 Seater Freightliner Party Bus', 'Party Bus', 37, 'Freightliner party bus with luxury perimeter seating and a restroom.', 'Luxury perimeter seating,Level 3 sound system,Fiber optic and RGB lighting,Restroom'],
    ['34 Seater Party Bus 696', 'Party Bus', 34, 'Party bus with three bars, hardwood floors and a restroom.', 'State of the art sound system,LCD TV screen,Neon and fiber optic and LED lighting,Textured mirrored ceiling,Hardwood floors,Three bars,Bathroom,Aux capability'],
    ['34 Seater Party Bus 699', 'Party Bus', 34, 'Party bus with two bars, hardwood floors and a restroom.', 'State of the art sound system,LCD TV screen,Neon and fiber optic and LED lighting,Textured mirrored ceiling,Hardwood floors,Two bars,Bathroom,Bluetooth and aux capability'],
    ['33 Seater Ford F550 Party Bus', 'Party Bus', 33, 'Ford F550 party bus with perimeter seating, two 50 inch smart TVs and a surround sound system.', 'Perimeter seating,Wood floors,Chrome ceiling,Two 50 inch smart TVs,Fiber optic and RGB lighting,High end surround sound system,iPod hookup,Removable pole,Chrome wheels'],
    ['40 Seater Mardi Gras Trolley', 'Trolley', 40, 'Trolley seating up to 40 with heating and air conditioning.', 'Heating,Air conditioning'],
    ['30 Seater Trolley White', 'Trolley', 30, 'White trolley seating up to 30 with heating, air conditioning and Bluetooth.', 'Heating,Air conditioning,Bluetooth'],
    ['Dolly 34 Seater Trolley', 'Trolley', 34, 'Trolley seating up to 34 with heating and air conditioning.', 'Heating,Air conditioning'],
    ['26 Seater Transformer Hummer', 'Limo', 26, 'White Hummer limo for 26 with a black and white interior and a VIP section.', 'White exterior,Black and white interior,VIP section'],
  ];
  seed.forEach(([name, category, capacity, description, features], i) => insert('vehicles', { name, category, capacity, description, features, active: 1, sort: (i + 1) * 10, created_at: now(), updated_at: now() }));
}

/** Card processing fee for one card payment on an invoice: a percentage of the amount plus a flat amount, in cents. 0 when the invoice has no fee. */
export function cardFee(inv, amount_cents) {
  if (!inv || !inv.cc_fee_on) return 0;
  const pct = Math.max(0, Number(inv.cc_fee_pct) || 0), flat = Math.max(0, Math.round(Number(inv.cc_fee_flat_cents) || 0));
  if (!pct && !flat) return 0;
  return Math.round((Number(amount_cents) || 0) * pct / 100) + flat;
}
/** Plain description of the fee, shown wherever the customer sees the invoice. */
export function cardFeeText(inv, fmtMoney) {
  const pct = Number(inv.cc_fee_pct) || 0, flat = Math.round(Number(inv.cc_fee_flat_cents) || 0);
  const parts = [pct ? `${pct}%` : '', flat ? fmtMoney(flat) : ''].filter(Boolean).join(' + ');
  return `Paying by credit or debit card adds a processing fee of ${parts}, shown before you pay. There is no fee to pay by check, cash, Zelle or bank transfer.`;
}
