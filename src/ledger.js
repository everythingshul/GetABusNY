// The business ledger (all money in and out), invoice PDFs, and taking a one-off payment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { finalDropoff, normItinerary } from './itinerary.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { all, one, run, insert, update, now, token, randomRef, nextSeq, totals, parse, getSetting, localDate, log, cardFeeText } from './db.js';
import { recalcInvoice, recordPayment, sendInvoice, textCustomer, ensureCustomer, link, invoiceBalance, fmtDate } from './services.js';
import { chargeInvoice } from './cards.js';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'ledger');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const list = (k) => String(getSetting(k) || '').split(',').map((x) => x.trim()).filter(Boolean);
export const MAASER_PCT = 10; // fixed: ten percent of every dollar that comes in
export const ledgerOptions = () => ({ accounts: list('ledger_accounts'), paid_with: list('ledger_paid_with'), categories: list('ledger_categories'), maaser_pct: MAASER_PCT });
const maaserFor = (cents) => Math.round((cents * MAASER_PCT) / 100);

const METHODS = { card: 'Credit card (Stripe)', cash: 'Cash', check: 'Check', zelle: 'Zelle', ach: 'ACH / bank transfer', wire: 'Wire', other: 'Other', manual: 'Other', refund: 'Refund' };
const methodLabel = (m, stripe) => (m === 'refund' ? (stripe ? 'Refund to card (Stripe)' : 'Refund') : METHODS[m] || (m ? m[0].toUpperCase() + m.slice(1) : ''));
/** Card payments go through Stripe and cash is cash. Checks, Zelle and transfers land in the first account that is a bank account. */
const accountFor = (m) => {
  if (m === 'card' || m === 'refund') return 'Stripe';
  if (m === 'cash') return 'Cash';
  return list('ledger_accounts').find((a) => !/stripe|cash|credit card/i.test(a)) || '';
};

/** Mirror every completed payment and refund into the ledger (safe to call as often as you like). */
export function syncLedger() {
  const rows = all(`SELECT p.*, i.number inv_no, i.title inv_title, i.customer_id, c.name cname FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id
    WHERE p.status='succeeded' AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.src='payment' AND l.src_id=p.id) ORDER BY p.id`);
  for (const p of rows) {
    const out = p.amount_cents < 0, cents = Math.abs(p.amount_cents) + (out ? 0 : Number(p.fee_cents) || 0);
    insert('ledger', {
      date: localDate(new Date(p.created_at)), direction: out ? 'out' : 'in', amount_cents: cents, vendor: p.cname || '', invoice_ref: p.inv_no, description: out ? `Refund: ${p.inv_title || p.inv_no}` : p.inv_title || 'Payment',
      paid_with: methodLabel(p.method, p.stripe_pi), account: accountFor(p.method), notes: [p.reference ? `Ref: ${p.reference}` : '', p.fee_cents ? `Includes a ${usd(p.fee_cents)} card processing fee` : '', p.note || ''].filter(Boolean).join('. '),
      maaser_cents: out ? 0 : maaserFor(cents), category: out ? 'Refunds' : 'Sales', src: 'payment', src_id: p.id, invoice_id: p.invoice_id, customer_id: p.customer_id || null, created_by: 'system', created_at: p.created_at, updated_at: now(),
    });
  }
  return rows.length;
}

const row = (r) => ({ ...r, signed_cents: r.direction === 'out' ? -r.amount_cents : r.amount_cents, auto: r.src === 'payment', has_file: !!r.file, file: undefined });

/** from/to are YYYY-MM-DD or 'all'. */
export function ledgerList({ from, to, direction, account, category, q, limit = 5000 } = {}) {
  syncLedger();
  const w = [], p = [];
  if (/^\d{4}-\d\d-\d\d$/.test(from || '')) { w.push('date>=?'); p.push(from); }
  if (/^\d{4}-\d\d-\d\d$/.test(to || '')) { w.push('date<=?'); p.push(to); }
  if (direction === 'in' || direction === 'out') { w.push('direction=?'); p.push(direction); }
  if (account) { w.push('account=?'); p.push(account); }
  if (category) { w.push('category=?'); p.push(category); }
  if (q) { w.push('(vendor LIKE ? OR invoice_ref LIKE ? OR description LIKE ? OR notes LIKE ? OR account LIKE ? OR paid_with LIKE ?)'); const x = `%${q}%`; p.push(x, x, x, x, x, x); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
  const rows = all(`SELECT * FROM ledger${where} ORDER BY date DESC, id DESC LIMIT ?`, ...p, Math.min(Number(limit) || 5000, 20000)).map(row);
  const t = one(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN direction='in' THEN amount_cents END),0) money_in, COALESCE(SUM(CASE WHEN direction='out' THEN amount_cents END),0) money_out, COALESCE(SUM(CASE WHEN direction='in' THEN maaser_cents END),0) maaser, COALESCE(SUM(CASE WHEN direction='in' AND maaser_given=0 THEN maaser_cents END),0) maaser_owed, COALESCE(SUM(CASE WHEN direction='in' AND maaser_given=1 THEN maaser_cents END),0) maaser_given FROM ledger${where}`, ...p);
  const byCategory = all(`SELECT COALESCE(NULLIF(category,''),'(none)') k, direction, SUM(amount_cents) c, COUNT(*) n FROM ledger${where} GROUP BY k, direction ORDER BY c DESC`, ...p);
  const balances = all("SELECT COALESCE(NULLIF(account,''),'(no account)') k, SUM(CASE direction WHEN 'in' THEN amount_cents ELSE -amount_cents END) net, COUNT(*) n FROM ledger GROUP BY k ORDER BY net DESC");
  return { rows, totals: { entries: t.n, money_in: t.money_in, money_out: t.money_out, net: t.money_in - t.money_out, maaser: t.maaser, maaser_owed: t.maaser_owed, maaser_given: t.maaser_given }, byCategory, balances, options: ledgerOptions() };
}

const clean = (b, locked) => {
  const o = {};
  const str = (k, n = 300) => { if (k in b) o[k] = String(b[k] ?? '').trim().slice(0, n); };
  ['vendor', 'invoice_ref', 'description', 'paid_with', 'account', 'category'].forEach((k) => str(k, 200)); str('notes', 2000);
  if (!locked) {
    if ('direction' in b) { if (!['in', 'out'].includes(b.direction)) throw bad('Choose money in or money out.'); o.direction = b.direction; }
    if ('amount_cents' in b) { const c = Math.round(Number(b.amount_cents)); if (!Number.isFinite(c) || c <= 0 || c > 10_000_000_000) throw bad('Enter an amount greater than zero.'); o.amount_cents = c; }
    if ('date' in b) { if (!/^\d{4}-\d\d-\d\d$/.test(String(b.date))) throw bad('Enter a date.'); o.date = b.date; }
    for (const k of ['vendor_id', 'trip_id', 'customer_id', 'invoice_id']) if (k in b) o[k] = Number(b[k]) || null;
  }
  return o;
};

export function ledgerCreate(b, actor) {
  const o = clean({ ...b, direction: b.direction, date: b.date || localDate() }, false);
  if (!o.direction || !o.amount_cents) throw bad('Enter an amount and choose money in or money out.');
  if (o.invoice_id) { const i = one('SELECT number, customer_id FROM invoices WHERE id=?', o.invoice_id); if (!i) throw bad('That invoice does not exist.'); o.invoice_ref = o.invoice_ref || i.number; o.customer_id = o.customer_id || i.customer_id; }
  if (o.vendor_id) { const v = one('SELECT name FROM vendors WHERE id=?', o.vendor_id); if (v && !o.vendor) o.vendor = v.name; }
  o.maaser_cents = o.direction === 'in' ? maaserFor(o.amount_cents) : 0;
  const id = insert('ledger', { ...o, src: null, src_id: null, created_by: actor, created_at: now(), updated_at: now() });
  log(actor, 'ledger.added', 'ledger', id, `${o.direction} ${o.amount_cents}`);
  if (b.maaser_given && o.direction === 'in') ledgerMaaser(id, true, actor);
  return one('SELECT * FROM ledger WHERE id=?', id);
}
export function ledgerUpdate(id, b, actor) {
  const r = one('SELECT * FROM ledger WHERE id=?', id); if (!r) throw bad('Not found', 404);
  const o = clean(b, r.src === 'payment');
  const dir = o.direction || r.direction, amt = o.amount_cents || r.amount_cents;
  if (o.direction || o.amount_cents) o.maaser_cents = dir === 'in' ? maaserFor(amt) : 0;
  update('ledger', id, { ...o, updated_at: now() });
  const linked = one('SELECT id FROM ledger WHERE maaser_of=?', id);
  if (linked && dir === 'out') { run('DELETE FROM ledger WHERE maaser_of=?', id); update('ledger', id, { maaser_given: 0, maaser_given_at: null }); }
  else if (linked && o.maaser_cents != null) update('ledger', linked.id, { amount_cents: o.maaser_cents, updated_at: now() });
  log(actor, 'ledger.edited', 'ledger', id);
  return one('SELECT * FROM ledger WHERE id=?', id);
}
export function ledgerDelete(id, actor) {
  const r = one('SELECT * FROM ledger WHERE id=?', id); if (!r) throw bad('Not found', 404);
  if (r.src === 'payment') throw bad('This entry comes from a payment on an invoice. To reverse it, refund the payment.');
  if (r.file) try { fs.unlinkSync(path.join(DIR, path.basename(r.file))); } catch { /* already gone */ }
  run('DELETE FROM ledger WHERE maaser_of=?', id); // the charity expense made from this entry goes with it
  if (r.maaser_of) update('ledger', r.maaser_of, { maaser_given: 0, maaser_given_at: null }); // deleting the expense puts the maaser back to "not given"
  run('DELETE FROM ledger WHERE id=?', id); log(actor, 'ledger.deleted', 'ledger', id, `${r.direction} ${r.amount_cents}`);
}

/** Mark the maaser on a money-in entry as given (records the charity expense) or not given (removes that expense). */
export function ledgerMaaser(id, given, actor) {
  const r = one('SELECT * FROM ledger WHERE id=?', id); if (!r) throw bad('Not found', 404);
  if (r.direction !== 'in') throw bad('Maaser is only set aside on money that comes in.');
  const existing = one('SELECT id FROM ledger WHERE maaser_of=?', id);
  if (given && !existing) {
    insert('ledger', { date: localDate(), direction: 'out', amount_cents: r.maaser_cents, vendor: 'Charity (maaser)', invoice_ref: '', description: `Maaser on ${r.description || r.invoice_ref || 'income'}`, paid_with: '', account: '', category: 'Maaser', notes: `Ten percent of ${usd(r.amount_cents)} received ${r.date}`, maaser_cents: 0, maaser_of: id, src: null, src_id: null, created_by: actor, created_at: now(), updated_at: now() });
  } else if (!given && existing) run('DELETE FROM ledger WHERE id=?', existing.id);
  update('ledger', id, { maaser_given: given ? 1 : 0, maaser_given_at: given ? now() : null, updated_at: now() });
  log(actor, given ? 'ledger.maaser_given' : 'ledger.maaser_undone', 'ledger', id, usd(r.maaser_cents));
  return one('SELECT * FROM ledger WHERE id=?', id);
}

// ---- attachments (receipts, vendor invoices, bank statements)
const sniff = (b) => (b.subarray(0, 4).toString() === '%PDF' ? ['pdf', 'application/pdf'] : b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? ['png', 'image/png'] : b.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ? ['jpg', 'image/jpeg'] : b.subarray(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null);
export function ledgerAttach(id, buf, name, actor) {
  const r = one('SELECT * FROM ledger WHERE id=?', id); if (!r) throw bad('Not found', 404);
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw bad('No file received.');
  const t = sniff(buf); if (!t) throw bad('Attach a PDF or a photo (JPG, PNG or WEBP).');
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${id}-${crypto.randomBytes(8).toString('hex')}.${t[0]}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  if (r.file) try { fs.unlinkSync(path.join(DIR, path.basename(r.file))); } catch { /* already gone */ }
  update('ledger', id, { file, file_name: String(name || `attachment.${t[0]}`).replace(/[\r\n"\\/]/g, '').slice(0, 120), file_type: t[1], updated_at: now() });
  log(actor, 'ledger.file', 'ledger', id, file);
}
export function ledgerFile(id) {
  const r = one('SELECT file, file_name, file_type FROM ledger WHERE id=?', id);
  if (!r?.file) return null;
  const f = path.join(DIR, path.basename(r.file)); return fs.existsSync(f) ? { path: f, name: r.file_name || r.file, type: r.file_type || 'application/octet-stream' } : null;
}
export function ledgerRemoveFile(id, actor) {
  const r = one('SELECT file FROM ledger WHERE id=?', id); if (!r) throw bad('Not found', 404);
  if (r.file) try { fs.unlinkSync(path.join(DIR, path.basename(r.file))); } catch { /* already gone */ }
  update('ledger', id, { file: null, file_name: null, file_type: null, updated_at: now() }); log(actor, 'ledger.file_removed', 'ledger', id);
}

// ---- invoice PDF (the document attached to every payment that came through an invoice)
const win = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');
const usd = (c) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export async function invoicePdf(invoice_id) {
  const i = one('SELECT * FROM invoices WHERE id=?', invoice_id); if (!i) throw bad('Invoice not found', 404);
  const c = one('SELECT name, company, email, phone FROM customers WHERE id=?', i.customer_id) || {};
  const items = parse(i.items, []), pays = all("SELECT * FROM payments WHERE invoice_id=? AND status='succeeded' ORDER BY id", i.id);
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]); let y = 750; const L = 54, R = 558;
  const ink = rgb(0.06, 0.13, 0.18), grey = rgb(0.35, 0.42, 0.48), line = rgb(0.58, 0.75, 0.2);
  const need = (h) => { if (y - h < 60) { page = doc.addPage([612, 792]); y = 750; } };
  const t = (s, { x = L, size = 10, f = font, color = ink, right = false } = {}) => { const str = win(s); const w = f.widthOfTextAtSize(str, size); page.drawText(str, { x: right ? R - w : x, y, size, font: f, color }); };
  t(getSetting('business_name'), { size: 20, f: bold }); y -= 18; t(`${getSetting('phone')}   ${getSetting('email')}`, { color: grey }); y -= 30;
  t(`Invoice ${i.number}`, { size: 14, f: bold }); t(i.status.toUpperCase(), { right: true, f: bold, color: i.status === 'paid' ? rgb(0.2, 0.5, 0.1) : grey }); y -= 16;
  t(`Date: ${fmtDate(String(i.sent_at || i.created_at).slice(0, 10))}${i.due_date ? `     Due: ${fmtDate(i.due_date)}` : ''}`, { color: grey }); y -= 24;
  t('Bill to', { f: bold }); y -= 14; t(`${c.name || ''}${c.company ? ', ' + c.company : ''}`); y -= 12; t(`${c.email || ''}  ${c.phone || ''}`, { color: grey }); y -= 28;
  page.drawLine({ start: { x: L, y: y + 8 }, end: { x: R, y: y + 8 }, thickness: 0.8, color: line });
  t('Description', { f: bold }); t('Qty', { x: 380, f: bold }); t('Price', { x: 430, f: bold }); t('Amount', { right: true, f: bold }); y -= 18;
  for (const it of items) { need(20); const amt = Math.round((Number(it.qty) || 0) * (Number(it.unit_cents) || 0)); t(String(it.desc || '').slice(0, 62)); t(String(it.qty ?? ''), { x: 380 }); t(usd(it.unit_cents), { x: 430 }); t(usd(amt), { right: true }); y -= 15; }
  y -= 6; page.drawLine({ start: { x: L, y: y + 8 }, end: { x: R, y: y + 8 }, thickness: 0.5, color: grey });
  const row2 = (l, v, f = font) => { need(18); t(l, { x: 380, f }); t(v, { right: true, f }); y -= 15; };
  { const tp = i.trip_id ? one('SELECT itinerary FROM trips WHERE id=?', i.trip_id) : null; const fd = tp ? finalDropoff(normItinerary(parse(tp.itinerary, []))) : ''; if (fd) { y += 6; t(`Final drop-off: ${fd}`, { size: 9, color: grey }); y -= 18; } }
  row2('Subtotal', usd(i.subtotal_cents)); if (i.tax_cents) row2(`Tax (${i.tax_rate}%)`, usd(i.tax_cents)); if (i.gratuity_cents) row2('Gratuity', usd(i.gratuity_cents));
  row2('Total', usd(i.total_cents), bold); row2('Paid', usd(i.amount_paid_cents)); row2('Balance due', usd(invoiceBalance(i)), bold);
  if (pays.length) { y -= 14; need(40); t('Payments', { f: bold }); y -= 15; for (const p of pays) { need(16); t(`${fmtDate(localDate(new Date(p.created_at)))}  ${methodLabel(p.method, p.stripe_pi)}${p.reference ? '  ' + p.reference : ''}`, { color: grey }); t(usd(p.amount_cents), { right: true }); y -= 14; } }
  if (i.cc_fee_on && (i.cc_fee_pct || i.cc_fee_flat_cents)) { y -= 14; need(40); t(cardFeeText(i, usd), { size: 8.5, color: grey }); y -= 12; }
  if (i.notes) { y -= 14; need(40); t('Notes', { f: bold }); y -= 14; t(String(i.notes).slice(0, 110), { color: grey }); }
  return Buffer.from(await doc.save());
}

// ---- take a payment that is not part of a trip: it becomes a one-line invoice, so receipts, refunds, the pay page and the ledger all work
export async function quickPayment(b, actor) {
  const cents = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(cents) || cents < 100 || cents > 100_000_000) throw bad('Enter an amount of at least $1.00.');
  const desc = String(b.description || '').trim().slice(0, 200) || 'Payment';
  const mode = ['link', 'received', 'card_on_file'].includes(b.mode) ? b.mode : 'link';
  let customer_id = Number(b.customer_id) || null;
  if (!customer_id) {
    const name = String(b.name || '').trim();
    if (!name) throw bad('Pick a customer or type a name.');
    if (mode !== 'received' && !b.email && !b.phone) throw bad('Add an email or phone number so the payment link can be sent.');
    customer_id = ensureCustomer({ name, email: String(b.email || '').trim(), phone: String(b.phone || '').trim(), company: b.company });
  }
  const c = one('SELECT * FROM customers WHERE id=?', customer_id); if (!c) throw bad('Customer not found.');
  const items = [{ desc, qty: 1, unit_cents: cents }];
  const id = insert('invoices', { number: randomRef('INV', 'invoices', 'number'), seq: nextSeq('invoices'), token: token(), customer_id, trip_id: null, quote_id: null, status: 'sent', title: desc, items, tax_rate: 0, ...totals(items, 0), deposit_cents: cents, due_date: localDate(), sent_at: now(), created_at: now(), updated_at: now() });
  recalcInvoice(id);
  let i = one('SELECT * FROM invoices WHERE id=?', id);
  const out = { invoice_id: id, number: i.number, url: link.pay(i) };
  if (mode === 'received') {
    recordPayment(id, { amount_cents: cents, method: ['cash', 'check', 'zelle', 'ach', 'wire', 'other'].includes(b.method) ? b.method : 'other', reference: String(b.reference || '').trim().slice(0, 120) || undefined, note: 'Payment taken in person', skip_email: !b.send_receipt_email, skip_sms: true }, actor);
    out.paid = true;
  } else if (mode === 'card_on_file') {
    await chargeInvoice(id, cents, actor); out.paid = true;
  } else {
    if (b.send_email && c.email) await sendInvoice(id, actor, { skip_email: false });
    if (b.send_sms && c.phone) { const r = await textCustomer(customer_id, `${getSetting('business_name')}\nPayment link for ${usd(cents)}:\n${out.url}`, 'manual', { force: true }); out.sms = r.ok ? 'sent' : r.error; }
  }
  log(actor, 'payment.quick', 'invoice', id, `${usd(cents)} ${mode}`);
  return out;
}
