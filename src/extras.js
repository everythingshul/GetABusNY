// Contracts (e-signature + PDF), calendar feeds (.ics), Excel export, website traffic.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { all, one, run, insert, update, now, token, nextNumber, getSetting, parse, log, totals } from './db.js';
import { sendEmail, emailShell, esc, money, BASE_URL, notifyOwner } from './integrations.js';
import { tripDetail, fmtWhen, localToDate, link, icsKey, naiveMs } from './services.js';
import { normItinerary, fromLegacy, itineraryText, KINDS, summarize } from './itinerary.js';
import { buildXlsx } from './xlsx.js';

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SIGS = path.join(DATA, 'signatures');
const PDFS = path.join(DATA, 'contracts');
for (const d of [SIGS, PDFS]) fs.mkdirSync(d, { recursive: true });

// =====================================================================================
// Contracts
// =====================================================================================
// Keep in sync with /terms. These are the key terms printed on every agreement; the full terms are incorporated by reference.
export const CONTRACT_TERMS = [
  'Get A Bus NY is a transportation broker. Service is provided by a licensed, insured third-party operator arranged by us.',
  'The deposit shown below is due to confirm this booking. The balance is due by the invoice due date. Card payments are processed by Stripe.',
  'Cancellation: 30 or more days before the trip, the deposit is retained and nothing more is due. 8 to 29 days before, 75% of the total is due. 7 days or fewer, or a no-show, 100% of the total is due.',
  'Price covers the itinerary listed here. Added pickups, stops, drop-offs, waiting time or hours are billed at the rates agreed with us; changes need our confirmation.',
  'Unless stated on the quote, gratuity, tolls, parking and surcharges are not included.',
  'The customer is responsible for the group\'s conduct and for damage or excessive cleaning beyond normal wear. No smoking. Alcohol only where the vehicle and passengers\' ages allow.',
  'The customer agrees to the full Terms & Conditions on our website, as in effect on the date of signing.',
];

export function buildSnapshot({ quote, trip, items, itinerary }) {
  const c = one('SELECT * FROM customers WHERE id=?', (quote || trip).customer_id) || {};
  const t = trip ? { ...trip, itinerary: normItinerary(parse(trip.itinerary, [])) } : null;
  const qt = quote ? parse(quote.trip, {}) : null;
  const it = itinerary || (t?.itinerary.length ? t.itinerary : normItinerary(qt?.itinerary?.length ? qt.itinerary : fromLegacy(qt || t || {})));
  const lines = items || parse((quote || {}).items, []);
  const taxRate = quote ? quote.tax_rate : Number(getSetting('tax_rate')) || 0;
  const tot = totals(lines, taxRate);
  const flat = qt || t || {};
  const veh = flat.vehicle_id ? one('SELECT name FROM vehicles WHERE id=?', flat.vehicle_id)?.name : null;
  const depPct = quote ? quote.deposit_pct : Number(getSetting('deposit_pct')) || 50;
  return {
    business: { name: getSetting('business_name'), phone: getSetting('phone'), email: getSetting('email'), address: getSetting('address') },
    customer: { name: c.name, email: c.email, phone: c.phone, company: c.company },
    trip: { purpose: flat.purpose || '', passengers: flat.passengers, depart_at: flat.depart_at, return_at: flat.return_at, vehicle: veh },
    itinerary: it, items: lines, tax_rate: taxRate, ...tot, deposit_pct: depPct, deposit_cents: Math.round((tot.total_cents * depPct) / 100),
    terms: CONTRACT_TERMS, prepared: now().slice(0, 10),
  };
}
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

export function createContract({ quote_id, trip_id }) {
  const quote = quote_id ? one('SELECT * FROM quotes WHERE id=?', quote_id) : null;
  const trip = trip_id ? one('SELECT * FROM trips WHERE id=?', trip_id) : quote_id ? one('SELECT * FROM trips WHERE quote_id=?', quote_id) : null;
  if (!quote && !trip) throw Object.assign(new Error('Nothing to build a contract from'), { status: 404 });
  let q = quote || (trip?.quote_id ? one('SELECT * FROM quotes WHERE id=?', trip.quote_id) : null);
  let items = q ? undefined : (() => { const inv = one('SELECT items FROM invoices WHERE trip_id=? ORDER BY id LIMIT 1', trip.id); return parse(inv?.items, []); })();
  const snap = buildSnapshot({ quote: q, trip, items });
  if (!snap.total_cents) throw Object.assign(new Error('Price the quote or trip first — the contract needs a total.'), { status: 400 });
  const id = insert('contracts', { number: nextNumber('CON'), trip_id: trip?.id || null, quote_id: q?.id || null, customer_id: (q || trip).customer_id, token: token(), status: 'draft', body: snap, body_hash: hash(snap), total_cents: snap.total_cents, created_at: now() });
  return one('SELECT * FROM contracts WHERE id=?', id);
}

export async function sendContract(id) {
  const k = one('SELECT * FROM contracts WHERE id=?', id);
  const c = one('SELECT * FROM customers WHERE id=?', k.customer_id);
  if (!c?.email) throw Object.assign(new Error('Customer has no email.'), { status: 400 });
  const r = await sendEmail(c.email, `Please review & sign — agreement ${k.number}`, emailShell('Your charter agreement', `<p>Hi ${esc((c.name || '').split(' ')[0])}, your trip agreement is ready. Review the itinerary and price, then sign online — it takes about a minute.</p><p><b>Total:</b> ${money(k.total_cents)}</p>`, { label: 'Review & sign', url: `${BASE_URL()}/contract/${k.token}` }));
  update('contracts', id, { status: k.status === 'signed' ? 'signed' : 'sent', sent_at: now() });
  log('admin', 'contract.sent', 'contract', id, c.email);
  return r;
}

export const contractView = (k) => ({ number: k.number, status: k.status, ...parse(k.body, {}), signer_name: k.signer_name, signed_at: k.signed_at, hash: k.body_hash });

const PNG = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
export async function signContract(k, { name, signature, agree }, { ip, ua }) {
  if (k.status === 'signed') throw Object.assign(new Error('This agreement is already signed.'), { status: 400 });
  if (k.status === 'void') throw Object.assign(new Error('This agreement is no longer valid.'), { status: 400 });
  name = String(name || '').trim().slice(0, 120);
  if (name.length < 2) throw Object.assign(new Error('Type your full name to sign.'), { status: 400 });
  if (!agree) throw Object.assign(new Error('Please check the box to agree and sign electronically.'), { status: 400 });
  const m = PNG.exec(String(signature || ''));
  if (!m || m[1].length > 400000) throw Object.assign(new Error('Please draw your signature.'), { status: 400 });
  const png = Buffer.from(m[1], 'base64');
  if (png.length < 100 || !png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) throw Object.assign(new Error('Invalid signature image.'), { status: 400 });
  const sigFile = `${k.token.slice(0, 12)}.png`;
  fs.writeFileSync(path.join(SIGS, sigFile), png);
  const c = one('SELECT * FROM customers WHERE id=?', k.customer_id) || {};
  const signed_at = now();
  const pdf = await contractPdf({ ...k, signer_name: name, signed_at, signer_ip: ip, body_hash: k.body_hash }, png);
  const pdfFile = `${k.number}.pdf`;
  fs.writeFileSync(path.join(PDFS, pdfFile), pdf);
  update('contracts', k.id, { status: 'signed', signer_name: name, signer_email: c.email, signature: sigFile, signed_at, signer_ip: ip, signer_ua: String(ua || '').slice(0, 300), pdf_file: pdfFile });
  log('customer', 'contract.signed', 'contract', k.id, `${name} from ${ip}`);
  const att = [{ filename: `${getSetting('business_name')} agreement ${k.number}.pdf`, content: pdf }];
  if (c.email) sendEmail(c.email, `Signed agreement ${k.number}`, emailShell('Agreement signed', `<p>Thank you, ${esc(name)}. Your signed copy is attached. Keep it for your records.</p>`), { attachments: att }).catch(() => {});
  notifyOwner(`Contract ${k.number} signed`, `${name} signed ${k.number} (${money(k.total_cents)}).`, 'contract_signed').catch(() => {});
  return { pdf_file: pdfFile };
}

const winAnsi = (s) => String(s ?? '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
export async function contractPdf(k, sigPng) {
  const b = parse(k.body, {});
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]); let y = 750; const L = 54, W = 504;
  const ink = rgb(0.06, 0.13, 0.18), grey = rgb(0.35, 0.42, 0.48);
  const need = (h) => { if (y - h < 60) { page = doc.addPage([612, 792]); y = 750; } };
  const text = (t, { size = 10, f = font, color = ink, x = L, width = W, gap = 3 } = {}) => {
    const words = winAnsi(t).split(/\s+/); let line = '';
    const flush = () => { need(size + gap); page.drawText(line, { x, y, size, font: f, color }); y -= size + gap; line = ''; };
    for (const w of words) { const next = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(next, size) > width && line) { flush(); line = w; } else line = next; }
    if (line) flush();
  };
  const head = (t) => { y -= 8; need(24); text(t, { size: 12, f: bold }); page.drawLine({ start: { x: L, y: y + 2 }, end: { x: L + W, y: y + 2 }, thickness: 0.6, color: rgb(0.58, 0.75, 0.2) }); y -= 4; };
  text(winAnsi(b.business?.name || 'Get A Bus NY'), { size: 20, f: bold }); y -= 2;
  text(`Charter Transportation Agreement ${k.number}`, { size: 12, f: bold, color: grey });
  text(`${b.business?.phone || ''}  ${b.business?.email || ''}`, { color: grey });
  head('Customer');
  text(`${b.customer?.name || ''}${b.customer?.company ? ' — ' + b.customer.company : ''}`); text(`${b.customer?.email || ''}  ${b.customer?.phone || ''}`);
  head('Trip');
  text(`${b.trip?.purpose ? b.trip.purpose + ' · ' : ''}Passengers: ${b.trip?.passengers || '—'}${b.trip?.vehicle ? ' · Vehicle: ' + b.trip.vehicle : ''}`);
  text(`Departure: ${fmtWhen(b.trip?.depart_at)}    Return: ${fmtWhen(b.trip?.return_at)}`);
  head('Itinerary');
  (b.itinerary || []).filter((x) => x.kind !== 'start' && x.kind !== 'end').forEach((x, i) => text(`${i + 1}. ${KINDS[x.kind]}: ${x.address}${x.time ? ' @ ' + fmtWhen(x.time) : ''}${x.wait_min ? ' (wait ' + x.wait_min + ' min)' : ''}${x.note ? ' — ' + x.note : ''}`));
  head('Price');
  (b.items || []).filter((x) => x.qty && x.unit_cents).forEach((x) => text(`${x.desc}    ${x.qty} x ${money(x.unit_cents)} = ${money(Math.round(x.qty * x.unit_cents))}`));
  if (b.tax_cents) text(`Tax (${b.tax_rate}%): ${money(b.tax_cents)}`);
  text(`TOTAL: ${money(b.total_cents)}    Deposit to book (${b.deposit_pct}%): ${money(b.deposit_cents)}`, { f: bold, size: 11 });
  head('Terms');
  (b.terms || []).forEach((t, i) => text(`${i + 1}. ${t}`, { size: 9 }));
  head('Signature');
  if (k.signed_at && sigPng) {
    need(110);
    const img = await doc.embedPng(sigPng); const dims = img.scaleToFit(220, 70);
    page.drawImage(img, { x: L, y: y - dims.height, width: dims.width, height: dims.height }); y -= dims.height + 6;
    text(`Signed electronically by ${k.signer_name} on ${new Date(k.signed_at).toUTCString()}`, { size: 9 });
    text(`IP ${k.signer_ip || 'n/a'} · Document fingerprint (SHA-256): ${k.body_hash}`, { size: 7, color: grey });
    text('Electronic signature has the same legal effect as a handwritten signature under the ESIGN Act and UETA.', { size: 7, color: grey });
  } else text('Not yet signed.', { color: grey });
  return Buffer.from(await doc.save());
}
export const contractPdfPath = (k) => (k.pdf_file ? path.join(PDFS, path.basename(k.pdf_file)) : null);

// =====================================================================================
// Calendar feeds (.ics) — subscribe from Google Calendar / Apple / Outlook ("add by URL")
// =====================================================================================
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (l) => (l.length <= 74 ? l : l.match(/.{1,73}/g).join('\r\n '));
function vevent(t, { staff, driverId }) {
  const start = localToDate(t.depart_at); if (!start) return '';
  const endNaive = t.return_at || null;
  let end = endNaive ? localToDate(endNaive) : new Date(start.getTime() + 4 * 3600000);
  if (end <= start) end = new Date(start.getTime() + 4 * 3600000);
  const it = normItinerary(parse(t.itinerary, [])).filter((x) => staff || (x.kind !== 'start' && x.kind !== 'end'));
  const first = it.find((x) => x.kind === 'pickup') || it[0];
  const desc = [
    `${t.ref} · ${t.status}`, t.purpose && `Trip: ${t.purpose}`, `Passengers: ${t.passengers || '?'}`, t.vehicle_name && `Vehicle: ${t.vehicle_name}`,
    staff && t.driver_name && `Driver: ${t.driver_name}`, staff && t.vendor_name && `Vendor: ${t.vendor_name}`,
    staff && t.customer_name && `Customer: ${t.customer_name} ${t.customer_phone || ''}`, '', 'Itinerary:', itineraryText(it), t.driver_notes && `\nNotes: ${t.driver_notes}`,
  ].filter((x) => x !== false && x !== null && x !== undefined).join('\n');
  const label = staff ? `${t.customer_name || t.ref} · ${t.passengers || '?'}p${t.purpose ? ' · ' + t.purpose : ''}` : `${t.pickup || 'Trip'} → ${t.dropoff || ''} (${t.passengers || '?'} pax)`;
  return ['BEGIN:VEVENT', `UID:trip-${t.id}${driverId ? '-d' + driverId : ''}@getabusny`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEsc(label)}`, first?.address ? `LOCATION:${icsEsc(first.address)}` : '', `DESCRIPTION:${icsEsc(desc)}`, `STATUS:${t.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Trip starts in 2 hours', 'END:VALARM', 'END:VEVENT'].filter(Boolean).join('\r\n');
}
export function icsDoc(name, events) {
  return fold('BEGIN:VCALENDAR') + '\r\n' + ['VERSION:2.0', 'PRODID:-//Get A Bus NY//Dispatch//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`, 'X-PUBLISHED-TTL:PT15M', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', ...events].map(fold).join('\r\n') + '\r\nEND:VCALENDAR\r\n';
}
const TRIPQ = `SELECT t.*, c.name customer_name, c.phone customer_phone, v.name vehicle_name, d.name driver_name, vn.name vendor_name FROM trips t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN vendors vn ON vn.id=t.vendor_id`;
export const staffCalendar = () => icsDoc(`${getSetting('business_name')} dispatch`, all(`${TRIPQ} WHERE t.depart_at IS NOT NULL AND t.depart_at>=? ORDER BY t.depart_at`, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).map((t) => vevent(t, { staff: true })));
export const driverCalendar = (d) => icsDoc(`${d.name} — ${getSetting('business_name')} trips`, all(`${TRIPQ} WHERE t.driver_id=? AND t.status<>'cancelled' AND t.depart_at>=? ORDER BY t.depart_at`, d.id, new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).map((t) => vevent(t, { staff: false, driverId: d.id })));
export function customerTripIcs(id, key) {
  if (key !== icsKey(id)) return null;
  const t = one(`${TRIPQ} WHERE t.id=?`, id); if (!t) return null;
  return icsDoc(`${getSetting('business_name')} trip`, [vevent({ ...t, driver_name: null, vendor_name: null }, { staff: false })]);
}

// =====================================================================================
// Excel export — everything
// =====================================================================================
const $c = (c) => (c == null ? '' : Number(c) / 100);
const ms = (iso) => (iso ? Date.parse(iso) : '');
const day = (s) => (s ? String(s).slice(0, 10) : '');
const when = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');
function range(col, from, to, p) { const w = []; if (from) { w.push(`substr(${col},1,10)>=?`); p.push(from); } if (to) { w.push(`substr(${col},1,10)<=?`); p.push(to); } return w.length ? ' WHERE ' + w.join(' AND ') : ''; }

const SHEETS = {
  customers: (f, t) => ({ name: 'Customers', cols: [{ h: 'ID', t: 'int' }, { h: 'Name' }, { h: 'Company' }, { h: 'Email' }, { h: 'Phone' }, { h: 'OK to text' }, { h: 'Address' }, { h: 'Tags' }, { h: 'Notes' }, { h: 'Created', t: 'datetime' }, { h: 'Trips', t: 'int' }, { h: 'Total billed', t: 'money' }, { h: 'Outstanding', t: 'money' }],
    rows: all('SELECT c.*, (SELECT COUNT(*) FROM trips x WHERE x.customer_id=c.id) n, (SELECT COALESCE(SUM(total_cents),0) FROM invoices i WHERE i.customer_id=c.id AND i.status<>\'void\') billed, (SELECT COALESCE(SUM(total_cents-amount_paid_cents),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN (\'sent\',\'partial\')) owed FROM customers c ORDER BY c.name').map((c) => [c.id, c.name, c.company, c.email, c.phone, c.sms_optin ? 'Yes' : 'No', c.address, c.tags, c.notes, ms(c.created_at), c.n, $c(c.billed), $c(c.owed)]) }),
  leads: (f, t) => { const p = []; return { name: 'Leads', cols: [{ h: 'Ref' }, { h: 'Status' }, { h: 'Name' }, { h: 'Email' }, { h: 'Phone' }, { h: 'Purpose' }, { h: 'Itinerary' }, { h: 'Depart' }, { h: 'Return' }, { h: 'Passengers', t: 'int' }, { h: 'Source' }, { h: 'Referred by' }, { h: 'Comments' }, { h: 'Notes' }, { h: 'Received', t: 'datetime' }],
    rows: all(`SELECT * FROM requests${range('created_at', f, t, p)} ORDER BY id`, ...p).map((r) => { const d = parse(r.details, {}); return [r.ref, r.status, r.name, r.email, r.phone, d.purpose, itineraryText(normItinerary(d.itinerary)), when(d.depart_at), when(d.return_at), d.passengers, r.source, r.referred_by, d.comments, r.notes, ms(r.created_at)]; }) }; },
  quotes: (f, t) => { const p = []; return { name: 'Quotes', cols: [{ h: 'Number' }, { h: 'Status' }, { h: 'Customer' }, { h: 'Title' }, { h: 'Subtotal', t: 'money' }, { h: 'Tax', t: 'money' }, { h: 'Total', t: 'money' }, { h: 'Deposit %', t: 'num' }, { h: 'Valid until', t: 'date' }, { h: 'Sent', t: 'datetime' }, { h: 'Viewed', t: 'datetime' }, { h: 'Accepted', t: 'datetime' }, { h: 'Created', t: 'datetime' }],
    rows: all(`SELECT q.*, c.name cn FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id${range('q.created_at', f, t, p)} ORDER BY q.id`, ...p).map((q) => [q.number, q.status, q.cn, q.title, $c(q.subtotal_cents), $c(q.tax_cents), $c(q.total_cents), q.deposit_pct, q.valid_until, ms(q.sent_at), ms(q.viewed_at), ms(q.accepted_at), ms(q.created_at)]) }; },
  quote_lines: () => ({ name: 'Quote lines', cols: [{ h: 'Quote' }, { h: 'Description' }, { h: 'Qty', t: 'num' }, { h: 'Unit price', t: 'money' }, { h: 'Amount', t: 'money' }], rows: all('SELECT number, items FROM quotes ORDER BY id').flatMap((q) => parse(q.items, []).map((i) => [q.number, i.desc, i.qty, $c(i.unit_cents), $c(Math.round(i.qty * i.unit_cents))])) }),
  trips: (f, t) => { const p = []; return { name: 'Trips', cols: [{ h: 'Ref' }, { h: 'Status' }, { h: 'Customer' }, { h: 'Purpose' }, { h: 'Depart' }, { h: 'Return' }, { h: 'Passengers', t: 'int' }, { h: 'Vehicle' }, { h: 'Driver' }, { h: 'Vendor' }, { h: 'Price', t: 'money' }, { h: 'Vendor cost', t: 'money' }, { h: 'Margin', t: 'money' }, { h: 'Itinerary' }, { h: 'Notes' }],
    rows: all(`${TRIPQ}${range('t.depart_at', f, t, p)} ORDER BY t.depart_at`, ...p).map((r) => [r.ref, r.status, r.customer_name, r.purpose, when(r.depart_at), when(r.return_at), r.passengers, r.vehicle_name, r.driver_name, r.vendor_name, $c(r.price_cents), $c(r.vendor_cost_cents), r.vendor_id ? $c(r.price_cents - r.vendor_cost_cents) : '', itineraryText(normItinerary(parse(r.itinerary, []))), r.notes]) }; },
  stops: () => ({ name: 'Itinerary stops', cols: [{ h: 'Trip' }, { h: '#', t: 'int' }, { h: 'Type' }, { h: 'Address' }, { h: 'Time' }, { h: 'Wait (min)', t: 'int' }, { h: 'Passengers', t: 'int' }, { h: 'Contact' }, { h: 'Phone' }, { h: 'Note' }], rows: all('SELECT ref, itinerary FROM trips ORDER BY depart_at').flatMap((t) => normItinerary(parse(t.itinerary, [])).map((x, i) => [t.ref, i + 1, KINDS[x.kind], x.address, when(x.time), x.wait_min, x.pax, x.contact_name, x.contact_phone, x.note])) }),
  invoices: (f, t) => { const p = []; return { name: 'Invoices', cols: [{ h: 'Number' }, { h: 'Status' }, { h: 'Customer' }, { h: 'Trip' }, { h: 'Title' }, { h: 'Subtotal', t: 'money' }, { h: 'Tax', t: 'money' }, { h: 'Total', t: 'money' }, { h: 'Paid', t: 'money' }, { h: 'Balance', t: 'money' }, { h: 'Due', t: 'date' }, { h: 'Sent', t: 'datetime' }, { h: 'Paid on', t: 'datetime' }, { h: 'Created', t: 'datetime' }],
    rows: all(`SELECT i.*, c.name cn, t.ref tr FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN trips t ON t.id=i.trip_id${range('i.created_at', f, t, p)} ORDER BY i.id`, ...p).map((i) => [i.number, i.status, i.cn, i.tr, i.title, $c(i.subtotal_cents), $c(i.tax_cents), $c(i.total_cents), $c(i.amount_paid_cents), $c(i.total_cents - i.amount_paid_cents), i.due_date, ms(i.sent_at), ms(i.paid_at), ms(i.created_at)]) }; },
  invoice_lines: () => ({ name: 'Invoice lines', cols: [{ h: 'Invoice' }, { h: 'Description' }, { h: 'Qty', t: 'num' }, { h: 'Unit price', t: 'money' }, { h: 'Amount', t: 'money' }], rows: all('SELECT number, items FROM invoices ORDER BY id').flatMap((q) => parse(q.items, []).map((i) => [q.number, i.desc, i.qty, $c(i.unit_cents), $c(Math.round(i.qty * i.unit_cents))])) }),
  payments: (f, t) => { const p = []; return { name: 'Payments', cols: [{ h: 'Date', t: 'datetime' }, { h: 'Invoice' }, { h: 'Customer' }, { h: 'Method' }, { h: 'Reference' }, { h: 'Amount', t: 'money' }, { h: 'Note' }],
    rows: all(`SELECT p.*, i.number inv, c.name cn FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id${range('p.created_at', f, t, p)} ORDER BY p.id`, ...p).map((x) => [ms(x.created_at), x.inv, x.cn, x.method, x.reference, $c(x.amount_cents), x.note]) }; },
  vendors: () => ({ name: 'Vendors', cols: [{ h: 'Name' }, { h: 'Contact' }, { h: 'Email' }, { h: 'Phone' }, { h: 'Vehicles' }, { h: 'Area' }, { h: 'Rating', t: 'int' }, { h: 'Active' }, { h: 'Notes' }], rows: all('SELECT * FROM vendors ORDER BY name').map((v) => [v.name, v.contact_name, v.email, v.phone, v.vehicle_types, v.service_area, v.rating, v.active ? 'Yes' : 'No', v.notes]) }),
  rfqs: () => ({ name: 'Vendor quote requests', cols: [{ h: 'Ref' }, { h: 'Vendor' }, { h: 'Status' }, { h: 'Price', t: 'money' }, { h: 'Vehicle offered' }, { h: 'Notes' }, { h: 'Sent', t: 'datetime' }, { h: 'Replied', t: 'datetime' }], rows: all('SELECT r.*, v.name vn FROM rfqs r JOIN vendors v ON v.id=r.vendor_id ORDER BY r.id').map((r) => [r.ref, r.vn, r.status, $c(r.price_cents), r.offered_vehicle, r.response_notes, ms(r.sent_at), ms(r.responded_at)]) }),
  drivers: () => ({ name: 'Drivers', cols: [{ h: 'Name' }, { h: 'Phone' }, { h: 'Email' }, { h: 'Active' }, { h: 'Notes' }], rows: all('SELECT * FROM drivers ORDER BY name').map((d) => [d.name, d.phone, d.email, d.active ? 'Yes' : 'No', d.notes]) }),
  fleet: () => ({ name: 'Fleet', cols: [{ h: 'Name' }, { h: 'Category' }, { h: 'Seats', t: 'int' }, { h: 'Features' }, { h: 'Description' }, { h: 'On website' }], rows: all('SELECT * FROM vehicles ORDER BY sort').map((v) => [v.name, v.category, v.capacity, v.features, v.description, v.active ? 'Yes' : 'No']) }),
  contracts: () => ({ name: 'Contracts', cols: [{ h: 'Number' }, { h: 'Status' }, { h: 'Customer' }, { h: 'Total', t: 'money' }, { h: 'Signed by' }, { h: 'Signed at', t: 'datetime' }, { h: 'IP' }, { h: 'Fingerprint' }], rows: all('SELECT k.*, c.name cn FROM contracts k LEFT JOIN customers c ON c.id=k.customer_id ORDER BY k.id').map((k) => [k.number, k.status, k.cn, $c(k.total_cents), k.signer_name, ms(k.signed_at), k.signer_ip, k.body_hash]) }),
  followups: () => ({ name: 'Follow-ups', cols: [{ h: 'Type' }, { h: 'For' }, { h: 'Kind' }, { h: 'Subject' }, { h: 'Due', t: 'datetime' }, { h: 'Status' }, { h: 'Result' }, { h: 'Automatic' }], rows: all('SELECT * FROM followups ORDER BY id').map((f) => [f.entity_type, f.entity_id, f.kind, f.subject, ms(f.due_at), f.status, f.result, f.auto ? 'Yes' : 'No']) }),
  messages: () => ({ name: 'Inbox', cols: [{ h: 'Received', t: 'datetime' }, { h: 'Name' }, { h: 'Email' }, { h: 'Phone' }, { h: 'Subject' }, { h: 'Message' }, { h: 'Status' }], rows: all('SELECT * FROM messages ORDER BY id').map((m) => [ms(m.created_at), m.name, m.email, m.phone, m.subject, m.body, m.status]) }),
  texts: () => ({ name: 'Text messages', cols: [{ h: 'Created', t: 'datetime' }, { h: 'To' }, { h: 'Type' }, { h: 'Status' }, { h: 'Message' }, { h: 'Error' }], rows: all('SELECT * FROM sms_log ORDER BY id').map((m) => [ms(m.created_at), m.to_phone, m.kind, m.status, m.body, m.error]) }),
  activity: () => ({ name: 'Activity', cols: [{ h: 'When', t: 'datetime' }, { h: 'Who' }, { h: 'Action' }, { h: 'Type' }, { h: 'ID', t: 'int' }, { h: 'Detail' }], rows: all('SELECT * FROM activity ORDER BY id').map((a) => [ms(a.at), a.actor, a.action, a.entity_type, a.entity_id, a.detail]) }),
  traffic: () => ({ name: 'Website traffic', cols: [{ h: 'Day', t: 'date' }, { h: 'Page views', t: 'int' }, { h: 'Visitors', t: 'int' }], rows: all('SELECT day, COUNT(*) v, COUNT(DISTINCT sid) u FROM page_views GROUP BY day ORDER BY day').map((r) => [r.day, r.v, r.u]) }),
};
export const EXPORT_KINDS = Object.keys(SHEETS);
export function exportWorkbook(kind, from, to) {
  const kinds = kind === 'all' ? EXPORT_KINDS : [kind];
  if (kinds.some((k) => !SHEETS[k])) throw Object.assign(new Error('Unknown export'), { status: 400 });
  const sheets = kinds.map((k) => SHEETS[k](from, to));
  // chat tables are created by the Chesky module; include them when present
  if (kind === 'all') {
    try {
      const convs = all('SELECT * FROM chat_conversations ORDER BY id').map((c) => [ms(c.created_at) || c.created_at, c.name, c.email, c.status || '']);
      sheets.push({ name: 'Chat handoffs', cols: [{ h: 'Started' }, { h: 'Name' }, { h: 'Email' }, { h: 'Status' }], rows: convs });
    } catch {}
  }
  return buildXlsx(sheets);
}

// =====================================================================================
// Website traffic (first-party, cookie-less, no IPs stored)
// =====================================================================================
export function trackView({ path: p, ref, sid, ua, country }) {
  p = String(p || '/').split('?')[0].slice(0, 120);
  if (/^\/(admin|api|d\/|v\/|pay\/|quote\/|contract\/)/.test(p)) p = '/' + (p.split('/')[1] || '') + '/…'; // never log token URLs
  if (/^\/(admin|api)/.test(p)) return;
  let host = ''; try { host = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch {}
  if (host === new URL(BASE_URL()).hostname.replace(/^www\./, '')) host = '';
  if (/bot|crawl|spider|preview|lighthouse/i.test(ua || '')) return;
  const d = new Date();
  run('INSERT INTO page_views(at,day,path,ref,sid,device,country) VALUES(?,?,?,?,?,?,?)', d.toISOString(), d.toISOString().slice(0, 10), p, host, String(sid || '').slice(0, 40), /mobile|iphone|android/i.test(ua || '') ? 'mobile' : 'desktop', String(country || '').slice(0, 2));
}
export function trafficReport(days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return {
    daily: all('SELECT day, COUNT(*) views, COUNT(DISTINCT sid) visitors FROM page_views WHERE day>=? GROUP BY day ORDER BY day', since),
    pages: all('SELECT path k, COUNT(*) c FROM page_views WHERE day>=? GROUP BY path ORDER BY c DESC LIMIT 10', since),
    refs: all("SELECT CASE WHEN ref='' THEN '(direct)' ELSE ref END k, COUNT(*) c FROM page_views WHERE day>=? GROUP BY k ORDER BY c DESC LIMIT 10", since),
    devices: all('SELECT device k, COUNT(DISTINCT sid) c FROM page_views WHERE day>=? GROUP BY device', since),
    totals: one('SELECT COUNT(*) views, COUNT(DISTINCT sid) visitors FROM page_views WHERE day>=?', since),
  };
}
