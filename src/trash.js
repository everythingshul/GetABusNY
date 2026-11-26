// The trash: anything deleted is moved here, whole, and never destroyed. It is removed from every list, total and report
// (it is not in the live tables), and can be restored exactly as it was.
import { db, all, one, run, now, log, tx } from './db.js';

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const FU = (type) => ['followups', `entity_type='${type}' AND entity_id=?`];

// entity (table) -> how to name it, what belongs to it, what stops it from being trashed
const SPECS = {
  requests: { label: 'Lead', type: 'request', title: (r) => `${r.ref || ''} ${r.name || ''}`, kids: () => [FU('request')] },
  quotes: { label: 'Quote', type: 'quote', title: (r) => `${r.number || ''} ${r.title || ''}`, kids: () => [['quote_revisions', 'quote_id=?'], FU('quote')] },
  invoices: {
    label: 'Invoice', type: 'invoice', title: (r) => `${r.number || ''} ${r.title || ''}`,
    guard: (r) => { if (one("SELECT 1 x FROM payments WHERE invoice_id=? AND status='authorized'", r.id)) throw bad('This invoice has a card hold. Release the hold first (open the invoice and click Release hold).'); },
    kids: () => [['ledger', "src='payment' AND src_id IN (SELECT id FROM payments WHERE invoice_id=?)"], ['payments', 'invoice_id=?'], FU('invoice')],
  },
  trips: { label: 'Trip', type: 'trip', title: (r) => `${r.ref || ''} ${r.title || r.purpose || ''}`, kids: () => [['trip_events', 'trip_id=?'], FU('trip')] },
  contracts: { label: 'Agreement', type: 'contract', title: (r) => `${r.number || ''} ${r.signer_name || ''}`, kids: () => [] },
  rfqs: { label: 'Vendor quote', type: 'rfq', title: (r) => `${r.ref || ''}`, kids: () => [] },
  customers: {
    label: 'Customer', type: 'customer', title: (r) => r.name || '',
    guard: (r) => { const n = (t) => one(`SELECT COUNT(*) c FROM ${t} WHERE customer_id=?`, r.id).c; if (n('trips') + n('quotes') + n('invoices') + n('requests') + n('contracts')) throw bad('This customer still has trips, quotes, invoices, leads or agreements. Move those to the trash first.'); },
    kids: () => [],
  },
  vendors: {
    label: 'Vendor', type: 'vendor', title: (r) => r.name || '',
    guard: (r) => { if (one('SELECT 1 x FROM trips WHERE vendor_id=?', r.id) || one('SELECT 1 x FROM rfqs WHERE vendor_id=?', r.id) || one('SELECT 1 x FROM drivers WHERE vendor_id=?', r.id)) throw bad('This vendor is used on trips, vendor quotes or drivers. Mark it inactive instead, or trash those first.'); },
    kids: () => [],
  },
  drivers: {
    label: 'Driver', type: 'driver', title: (r) => r.name || '',
    guard: (r) => { if (one('SELECT 1 x FROM trips WHERE driver_id=?', r.id)) throw bad('This driver is assigned to trips. Mark the driver inactive instead, or change those trips first.'); },
    kids: () => [],
  },
  vehicles: {
    label: 'Fleet vehicle', type: 'vehicle', title: (r) => r.name || '',
    guard: (r) => { if (one('SELECT 1 x FROM trips WHERE vehicle_id=?', r.id)) throw bad('This vehicle is used on trips. Mark it inactive instead, or change those trips first.'); },
    kids: () => [],
  },
  followups: { label: 'Follow-up', type: null, title: (r) => r.subject || r.kind || 'Follow-up', kids: () => [] },
  messages: { label: 'Inbox message', type: null, title: (r) => `${r.subject || ''} ${r.name || ''}`, kids: () => [] },
  ledger: {
    label: 'Ledger entry', type: 'ledger', title: (r) => `${r.vendor || ''} ${r.description || ''}`,
    guard: (r) => { if (r.src === 'payment') throw bad('This entry follows a payment on an invoice. To remove it, trash the invoice, or refund the payment.'); },
    kids: () => [['ledger', 'maaser_of=?']],
    after: (r) => { if (r.maaser_of) run('UPDATE ledger SET maaser_given=0, maaser_given_at=NULL WHERE id=?', r.maaser_of); },
    undo: (r) => { if (r.maaser_of) run('UPDATE ledger SET maaser_given=1, maaser_given_at=? WHERE id=?', now(), r.maaser_of); },
  },
};
export const TRASHABLE = Object.keys(SPECS);

const sub = (entity, r) => {
  const c = r.customer_id ? one('SELECT name FROM customers WHERE id=?', r.customer_id)?.name : '';
  const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (entity === 'invoices' || entity === 'quotes') return [c, money(r.total_cents), r.status].filter(Boolean).join('  ');
  if (entity === 'trips') return [c, r.depart_at ? String(r.depart_at).slice(0, 10) : '', r.status].filter(Boolean).join('  ');
  if (entity === 'ledger') return [r.date, r.direction === 'out' ? 'money out' : 'money in', money(r.amount_cents)].join('  ');
  return [c, r.email, r.phone].filter(Boolean).join('  ');
};

const kidRows = (spec, id) => {
  const out = {};
  const list = [...(spec.kids?.(id) || [])];
  if (spec.type) list.push(['label_links', 'entity_type=? AND entity_id=?', spec.type]);
  for (const k of list) {
    const [table, where, typeArg] = k;
    const params = typeArg ? [typeArg, id] : [id];
    (out[table] ||= []).push(...all(`SELECT * FROM ${table} WHERE ${where}`, ...params));
  }
  return { out, list };
};

/** Move one record (and what only exists because of it) to the trash. */
export function trashRecord(entity, id, actor = 'admin') {
  const spec = SPECS[entity]; if (!spec) throw bad('That cannot be moved to the trash.');
  id = Number(id); const row = one(`SELECT * FROM ${entity} WHERE id=?`, id); if (!row) throw bad('Not found', 404);
  spec.guard?.(row);
  const { out, list } = kidRows(spec, id);
  tx(() => {
    const tid = Number(db.prepare('INSERT INTO trash(entity, entity_id, title, sub, seq, data, children, deleted_by, deleted_at) VALUES(?,?,?,?,?,?,?,?,?)').run(entity, id, spec.title(row).replace(/\s+/g, ' ').trim(), sub(entity, row), row.seq ?? null, JSON.stringify(row), JSON.stringify(out), actor, now()).lastInsertRowid);
    for (const k of list) { const [table, where, typeArg] = k; db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...(typeArg ? [typeArg, id] : [id])); }
    db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(id);
    spec.after?.(row);
    return tid;
  });
  log(actor, `${entity}.trashed`, entity, id, spec.title(row).trim());
  return { ok: true };
}

const insertRow = (table, row) => { const keys = Object.keys(row); db.prepare(`INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k])); };

/** Put a trashed record back exactly as it was. The trash entry stays, marked as restored. */
export function restoreTrash(tid, actor = 'admin') {
  const t = one('SELECT * FROM trash WHERE id=?', tid); if (!t) throw bad('Not found', 404);
  if (t.restored_at) throw bad('This was already restored.');
  const spec = SPECS[t.entity], row = JSON.parse(t.data), kids = JSON.parse(t.children || '{}');
  if (one(`SELECT 1 x FROM ${t.entity} WHERE id=?`, row.id)) throw bad('Something else now uses this record number, so it cannot be restored.');
  if (row.customer_id && !one('SELECT 1 x FROM customers WHERE id=?', row.customer_id)) throw bad('Restore the customer first (it is in the trash too).');
  tx(() => {
    insertRow(t.entity, row);
    for (const [table, rows] of Object.entries(kids)) for (const r of rows) insertRow(table, r);
    db.prepare('UPDATE trash SET restored_at=?, restored_by=? WHERE id=?').run(now(), actor, tid);
    spec.undo?.(row);
  });
  if (t.entity === 'invoices') { import('./services.js').then((S) => S.recalcInvoice(row.id)).catch(() => {}); }
  log(actor, `${t.entity}.restored`, t.entity, row.id, t.title);
  return { ok: true, entity: t.entity, id: row.id };
}

export function trashList() {
  return all('SELECT id, entity, entity_id, title, sub, deleted_by, deleted_at, restored_at, restored_by FROM trash ORDER BY id DESC LIMIT 1000').map((r) => ({ ...r, label: SPECS[r.entity]?.label || r.entity }));
}
