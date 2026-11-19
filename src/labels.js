// Labels, like Gmail: colored, nestable, and attachable to almost anything in the back office.
import { all, one, run, insert, update, now, log } from './db.js';

const TABLE = { customer: 'customers', request: 'requests', quote: 'quotes', trip: 'trips', invoice: 'invoices', contract: 'contracts', vendor: 'vendors', driver: 'drivers', vehicle: 'vehicles', ledger: 'ledger', payment: 'payments', rfq: 'rfqs' };
export const LABEL_TYPES = Object.keys(TABLE);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
// Gmail-style palette (background colors; text color is worked out from brightness in the screen)
export const PALETTE = ['#e7e7e7', '#b6cff5', '#98d7e4', '#e3d7ff', '#fbd3e0', '#f2b2a8', '#c2c2c2', '#4986e7', '#2da2bb', '#b99aff', '#994a64', '#f691b2', '#ff7537', '#ffad46', '#662e37', '#ebdbde', '#cca6ac', '#42d692', '#16a765', '#fad165', '#fb4c2f', '#ffdeb5', '#fbe983', '#b3efd3', '#a2dcc1'];
const okColor = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));

/** All labels in tree order, each with its full path ("Parent/Child"), depth and number of items. */
export function allLabels() {
  const rows = all('SELECT * FROM labels ORDER BY sort, lower(name), id');
  const counts = Object.fromEntries(all('SELECT label_id k, COUNT(*) n FROM label_links GROUP BY label_id').map((r) => [r.k, r.n]));
  const kids = {}; for (const r of rows) (kids[r.parent_id || 0] ||= []).push(r);
  const out = []; const walk = (pid, path, depth) => { for (const r of kids[pid] || []) { const p = path ? `${path}/${r.name}` : r.name; out.push({ id: r.id, name: r.name, color: r.color, parent_id: r.parent_id, path: p, depth, count: counts[r.id] || 0 }); walk(r.id, p, depth + 1); } };
  walk(0, '', 0);
  // anything whose parent went missing still shows up at the top
  const seen = new Set(out.map((x) => x.id)); for (const r of rows) if (!seen.has(r.id)) out.push({ id: r.id, name: r.name, color: r.color, parent_id: null, path: r.name, depth: 0, count: counts[r.id] || 0 });
  return out;
}
/** { type: { id: [labelId, ...] } } for every labeled item. */
export function allLinks() {
  const out = {};
  for (const r of all('SELECT label_id l, entity_type t, entity_id i FROM label_links')) ((out[r.t] ||= {})[r.i] ||= []).push(r.l);
  return out;
}
const descendants = (id) => { const ids = [id]; for (let i = 0; i < ids.length; i++) for (const c of all('SELECT id FROM labels WHERE parent_id=?', ids[i])) if (!ids.includes(c.id)) ids.push(c.id); return ids; };
const depthOf = (id) => { let d = 0, cur = id; while (cur && d < 20) { cur = one('SELECT parent_id p FROM labels WHERE id=?', cur)?.p; if (cur) d++; } return d; };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const sibling = (name, parent) => one('SELECT id FROM labels WHERE lower(name)=lower(?) AND parent_id IS ?', name, parent || null);

/** "Camps/Summer/Opening day" creates the whole path and returns the last label. */
export function createLabel({ name, color, parent_id } = {}, actor = 'admin') {
  const parts = String(name || '').split('/').map(clean).filter(Boolean);
  if (!parts.length) throw bad('Give the label a name.');
  let parent = Number(parent_id) || null; if (parent && !one('SELECT 1 x FROM labels WHERE id=?', parent)) throw bad('That parent label does not exist.');
  if (parent && depthOf(parent) + parts.length > 5) throw bad('Labels can be nested up to five levels.');
  let last = null;
  parts.forEach((p, i) => {
    const existing = sibling(p, parent);
    if (existing) { last = existing.id; parent = existing.id; return; }
    const c = i === parts.length - 1 && okColor(color) ? color.toLowerCase() : PALETTE[all('SELECT id FROM labels').length % PALETTE.length];
    last = insert('labels', { name: p, color: c, parent_id: parent, sort: 0, created_at: now(), updated_at: now() }); parent = last;
  });
  log(actor, 'label.created', 'label', last, parts.join('/'));
  return one('SELECT * FROM labels WHERE id=?', last);
}
export function updateLabel(id, b = {}, actor = 'admin') {
  const l = one('SELECT * FROM labels WHERE id=?', id); if (!l) throw bad('Label not found', 404);
  const o = {};
  if ('name' in b) { const n = clean(b.name).replace(/\//g, ' '); if (!n) throw bad('Give the label a name.'); o.name = n; }
  if ('color' in b) { if (!okColor(b.color)) throw bad('Pick a color.'); o.color = b.color.toLowerCase(); }
  if ('parent_id' in b) {
    const p = Number(b.parent_id) || null;
    if (p) { if (!one('SELECT 1 x FROM labels WHERE id=?', p)) throw bad('That parent label does not exist.'); if (descendants(id).includes(p)) throw bad('A label cannot be nested under itself.'); if (depthOf(p) + 1 + Math.max(0, ...descendants(id).map((d) => depthOf(d) - depthOf(id))) >= 5) throw bad('Labels can be nested up to five levels.'); }
    o.parent_id = p;
  }
  const nm = o.name ?? l.name, par = 'parent_id' in o ? o.parent_id : l.parent_id;
  const clash = sibling(nm, par); if (clash && clash.id !== id) throw bad(`There is already a label called "${nm}" there.`);
  update('labels', id, { ...o, updated_at: now() }); log(actor, 'label.edited', 'label', id);
  return one('SELECT * FROM labels WHERE id=?', id);
}
export function deleteLabel(id, actor = 'admin') {
  const l = one('SELECT * FROM labels WHERE id=?', id); if (!l) throw bad('Label not found', 404);
  run('UPDATE labels SET parent_id=? WHERE parent_id=?', l.parent_id || null, id); // children move up one level
  run('DELETE FROM label_links WHERE label_id=?', id); run('DELETE FROM labels WHERE id=?', id);
  log(actor, 'label.deleted', 'label', id, l.name);
}
/** Replace the labels on one item. */
export function setLabels(type, id, labelIds, actor = 'admin') {
  const t = TABLE[type]; if (!t) throw bad('You cannot label that.');
  if (!one(`SELECT 1 x FROM ${t} WHERE id=?`, id)) throw bad('Item not found', 404);
  const ids = [...new Set((Array.isArray(labelIds) ? labelIds : []).map(Number).filter(Boolean))].filter((x) => one('SELECT 1 x FROM labels WHERE id=?', x)).slice(0, 40);
  run('DELETE FROM label_links WHERE entity_type=? AND entity_id=?', type, id);
  for (const l of ids) run('INSERT OR IGNORE INTO label_links(label_id, entity_type, entity_id) VALUES(?,?,?)', l, type, id);
  log(actor, 'label.assigned', type, id, ids.join(','));
  return ids;
}
/** Names of an item's labels, for exports. */
export function labelNames(type, id) { return all('SELECT l.id FROM label_links k JOIN labels l ON l.id=k.label_id WHERE k.entity_type=? AND k.entity_id=?', type, id).map((r) => allLabels().find((x) => x.id === r.id)?.path).filter(Boolean).join('; '); }
