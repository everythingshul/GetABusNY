// One search box for the whole back office: quote and invoice numbers, names, phone numbers, addresses, notes, amounts, anything.
// Every word typed must appear somewhere in the record (any order, partial words are fine).
import { all } from './db.js';

const phoneNorm = (c) => `replace(replace(replace(replace(replace(coalesce(${c},''),'-',''),' ',''),'(',''),')',''),'+','')`;
const cat = (...cols) => `lower(${cols.map((c) => `coalesce(${c},'')`).join(`||' '||`)})`;

// type, label, FROM clause, id, title, sub, ref (exact-match ranking), blob (everything searchable), extra select
const SPECS = [
  { type: 'quote', label: 'Quote', from: 'quotes q LEFT JOIN customers c ON c.id=q.customer_id', id: 'q.id', title: `q.number||'  '||coalesce(q.title,'')`, sub: `coalesce(c.name,'')||'  '||q.status||'  '||'$'||(q.total_cents/100)`, ref: 'q.number',
    blob: cat('q.number', "'#'||q.seq", 'q.title', 'q.notes', 'q.trip', 'c.name', 'c.company', 'c.email', 'c.phone', phoneNorm('c.phone'), 'cast(q.total_cents/100 as text)', 'q.status') },
  { type: 'invoice', label: 'Invoice', from: 'invoices i LEFT JOIN customers c ON c.id=i.customer_id', id: 'i.id', title: `i.number||'  '||coalesce(i.title,'')`, sub: `coalesce(c.name,'')||'  '||i.status||'  '||'$'||(i.total_cents/100)`, ref: 'i.number',
    blob: cat('i.number', "'#'||i.seq", 'i.title', 'i.notes', 'c.name', 'c.company', 'c.email', 'c.phone', phoneNorm('c.phone'), 'cast(i.total_cents/100 as text)', 'i.status') },
  { type: 'request', label: 'Lead', from: 'requests r', id: 'r.id', title: `r.ref||'  '||coalesce(r.name,'')`, sub: `coalesce(r.email,'')||'  '||coalesce(r.phone,'')||'  '||r.status`, ref: 'r.ref',
    blob: cat('r.ref', "'#'||r.seq", 'r.name', 'r.email', 'r.phone', phoneNorm('r.phone'), 'r.details', 'r.notes', 'r.status') },
  { type: 'customer', label: 'Customer', from: 'customers c', id: 'c.id', title: 'c.name', sub: `coalesce(c.company,'')||'  '||coalesce(c.email,'')||'  '||coalesce(c.phone,'')`, ref: 'c.name',
    blob: cat('c.name', 'c.company', 'c.email', 'c.phone', phoneNorm('c.phone'), 'c.address', 'c.notes', 'c.tags') },
  { type: 'trip', label: 'Trip', from: 'trips t LEFT JOIN customers c ON c.id=t.customer_id', id: 't.id', title: `t.ref||'  '||coalesce(c.name,'')`, sub: `coalesce(t.pickup,'')||' to '||coalesce(t.dropoff,'')||'  '||coalesce(substr(t.depart_at,1,10),'')||'  '||t.status`, ref: 't.ref',
    blob: cat('t.ref', "'#'||t.seq", 't.title', 't.purpose', 't.pickup', 't.dropoff', 't.stops', 't.itinerary', 't.notes', 'c.name', 'c.phone', phoneNorm('c.phone'), 't.status', 't.depart_at') },
  { type: 'payment', label: 'Payment', from: 'payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id', id: 'p.id', title: `'Payment on '||i.number||'  $'||(p.amount_cents/100)`, sub: `coalesce(c.name,'')||'  '||coalesce(p.method,'')||'  '||coalesce(p.reference,'')`, ref: 'p.reference', extra: 'i.id invoice_id',
    blob: cat('p.reference', 'p.note', 'p.method', 'i.number', 'c.name', 'cast(p.amount_cents/100 as text)') },
  { type: 'contract', label: 'Agreement', from: 'contracts k LEFT JOIN customers c ON c.id=k.customer_id', id: 'k.id', title: `k.number||'  '||coalesce(c.name,'')`, sub: `k.status||'  '||coalesce(k.signer_name,'')`, ref: 'k.number',
    blob: cat('k.number', 'k.signer_name', 'k.signer_email', 'c.name', 'c.phone', phoneNorm('c.phone'), 'k.status') },
  { type: 'rfq', label: 'Vendor quote', from: 'rfqs f LEFT JOIN vendors v ON v.id=f.vendor_id', id: 'f.id', title: `f.ref||'  '||coalesce(v.name,'')`, sub: `f.status||'  '||coalesce('$'||(f.price_cents/100),'')`, ref: 'f.ref',
    blob: cat('f.ref', 'v.name', 'f.response_notes', 'f.offered_vehicle', 'f.status') },
  { type: 'vendor', label: 'Vendor', from: 'vendors v', id: 'v.id', title: 'v.name', sub: `coalesce(v.contact_name,'')||'  '||coalesce(v.phone,'')||'  '||coalesce(v.email,'')`, ref: 'v.name',
    blob: cat('v.name', 'v.contact_name', 'v.email', 'v.phone', phoneNorm('v.phone'), 'v.service_area', 'v.vehicle_types', 'v.notes', 'v.mc_number', 'v.dot_number') },
  { type: 'driver', label: 'Driver', from: 'drivers d', id: 'd.id', title: 'd.name', sub: `coalesce(d.phone,'')||'  '||coalesce(d.email,'')`, ref: 'd.name',
    blob: cat('d.name', 'd.phone', phoneNorm('d.phone'), 'd.email', 'd.notes') },
  { type: 'vehicle', label: 'Fleet', from: 'vehicles x', id: 'x.id', title: 'x.name', sub: `coalesce(x.category,'')||'  '||coalesce(x.capacity,'')||' seats'`, ref: 'x.name',
    blob: cat('x.name', 'x.category', 'x.description', 'x.features', 'x.internal_notes') },
  { type: 'ledger', label: 'Ledger', from: 'ledger l', id: 'l.id', title: `coalesce(l.vendor,'')||'  '||coalesce(l.description,'')`, sub: `l.date||'  '||l.direction||'  $'||(l.amount_cents/100)`, ref: 'l.invoice_ref',
    blob: cat('l.vendor', 'l.description', 'l.invoice_ref', 'l.notes', 'l.category', 'l.account', 'cast(l.amount_cents/100 as text)', 'l.date') },
  { type: 'message', label: 'Inbox', from: 'messages m', id: 'm.id', title: `coalesce(m.subject,'')||'  '||coalesce(m.name,'')`, sub: `coalesce(m.email,'')||'  '||coalesce(m.phone,'')`, ref: 'm.subject',
    blob: cat('m.name', 'm.email', 'm.phone', phoneNorm('m.phone'), 'm.subject', 'm.body') },
];

export function searchAll(raw) {
  const q = String(raw || '').trim().slice(0, 80);
  if (!q) return [];
  const toks = [...new Set(q.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean))].slice(0, 6);
  if (!toks.length) return [];
  const digits = q.replace(/\D/g, '');
  const out = [];
  for (const s of SPECS) {
    // each word must match; a word of digits also matches a phone number written any way
    const where = toks.map((t) => { const d = t.replace(/\D/g, ''); return d.length >= 3 && d === t ? `(${s.blob} LIKE ? OR ${s.blob} LIKE ?)` : `${s.blob} LIKE ?`; }).join(' AND ');
    const params = toks.flatMap((t) => { const d = t.replace(/\D/g, ''); return d.length >= 3 && d === t ? [`%${t}%`, `%${d}%`] : [`%${t}%`]; });
    let rows;
    try { rows = all(`SELECT ${s.id} id, ${s.title} title, ${s.sub} sub, ${s.ref} ref${s.extra ? `, ${s.extra}` : ''} FROM ${s.from} WHERE ${where} ORDER BY ${s.id} DESC LIMIT 20`, ...params); } catch { rows = []; }
    for (const r of rows) {
      const ql = q.toLowerCase().replace(/^#/, ''), ref = String(r.ref || '').toLowerCase(), title = String(r.title || '').toLowerCase();
      let score = 0;
      if (ref === ql) score += 100; else if (ref.startsWith(ql)) score += 60; else if (ref.includes(ql)) score += 35;
      if (title.startsWith(ql)) score += 25; else if (title.includes(ql)) score += 15;
      if (toks.every((t) => title.includes(t))) score += 10;
      if (digits.length >= 3 && String(r.sub || '').replace(/\D/g, '').includes(digits)) score += 8;
      out.push({ type: s.type, label: s.label, id: r.id, invoice_id: r.invoice_id, title: String(r.title || '').replace(/\s+/g, ' ').trim(), sub: String(r.sub || '').replace(/\s+/g, ' ').trim(), score });
    }
  }
  const perType = {};
  return out.sort((a, b) => b.score - a.score || b.id - a.id).filter((r) => (perType[r.type] = (perType[r.type] || 0) + 1) <= 6).slice(0, 40);
}
