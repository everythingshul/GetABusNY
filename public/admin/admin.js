// Get A Bus NY admin, dependency-free single page app.
import { itineraryEditor, KIND_LABELS } from '/js/itinerary.js';
import { attachPlaces } from '/js/places.js';
import { renderChat } from '/admin/chesky-admin.js';
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const c2d = (c) => ((Number(c) || 0) / 100).toFixed(2);
const d2c = (v) => Math.round((parseFloat(v) || 0) * 100);
const usd = (c) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmt = (s) => { if (!s) return '-'; const d = new Date(s.length === 10 ? s + 'T00:00:00Z' : s.length === 16 ? s + ':00Z' : s); return d.toLocaleString('en-US', { timeZone: s.length <= 16 ? 'UTC' : undefined, month: 'short', day: 'numeric', year: 'numeric', ...(s.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}) }); };
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const J = (o) => { try { return typeof o === 'string' ? JSON.parse(o) : o || {}; } catch { return {}; } };

async function api(method, path, body) {
  const r = await fetch('/api/admin' + path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const GET = (p) => api('GET', p), POST = (p, b = {}) => api('POST', p, b), PUT = (p, b) => api('PUT', p, b), DEL = (p) => api('DELETE', p);
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const guard = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { if (e.message !== 'Signed out') toast(e.message, true); } };

const SB = { new: 'b', quoting: 'b', quoted: 'b', converted: 'g', lost: 'r', draft: 'a', sent: 'b', accepted: 'g', declined: 'r', expired: 'r', booked: 'b', confirmed: 'g', in_progress: 'a', completed: 'g', cancelled: 'r', partial: 'a', paid: 'g', void: 'r', pending: 'a', failed: 'r', skipped: '', responded: 'a', closed: '', read: '', done: 'g' };
const badge = (s) => `<span class="badge b-${SB[s] ?? ''}">${esc(String(s || '').replace('_', ' '))}</span>`;

// ---------- modal ----------
function modal({ title, body, footer = '', small = false, onMount }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${small ? 'sm' : ''}" role="dialog" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button aria-label="Close">×</button></header><div class="mb">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  document.body.append(ov);
  const close = () => ov.remove();
  ov.querySelector('header button').onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !ov.querySelector(':focus')?.matches('input,textarea,select')) ov._down = true; else ov._down = false; });
  ov.addEventListener('mouseup', (e) => { if (e.target === ov && ov._down) close(); });
  onMount?.(ov, close);
  return { ov, close };
}
const button = (label, cls = '', attrs = '') => `<button class="btn ${cls}" ${attrs}>${label}</button>`;
async function confirmBox(msg) { return confirm(msg); }

// ---------- forms ----------
const opts = (list, label, blank = '(none)') => [['', blank], ...list.map((x) => [x.id, label(x)])];
function fld(f, v = {}) {
  if (f.t === 'custom') return `<div class="full">${f.html}</div>`;
  const val = v[f.k] ?? f.def ?? '';
  const id = 'f_' + f.k; let i;
  if (f.t === 'textarea') i = `<textarea id="${id}" ${f.rows ? `rows="${f.rows}"` : ''}>${esc(val)}</textarea>`;
  else if (f.t === 'select') i = `<select id="${id}">${f.o.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.t === 'money') i = `<input id="${id}" type="number" step="0.01" min="0" value="${val === '' ? '' : c2d(val)}">`;
  else if (f.t === 'check') return `<label class="${f.full ? 'full' : ''}" style="display:flex;gap:8px;align-items:center"><input id="${id}" type="checkbox" ${Number(val) ? 'checked' : ''}> ${esc(f.l)}</label>`;
  else if (f.t === 'datetime') i = `<input id="${id}" type="datetime-local" value="${esc(String(val).slice(0, 16))}">`;
  else if (f.t === 'date') i = `<input id="${id}" type="date" value="${esc(String(val).slice(0, 10))}">`;
  else if (f.t === 'number') i = `<input id="${id}" type="number" step="${f.step || 1}" value="${esc(val)}">`;
  else i = `<input id="${id}" type="${f.t || 'text'}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.places ? 'data-places autocomplete="off"' : ''}>`;
  return `<label class="${f.full ? 'full' : ''}">${esc(f.l)}${f.req ? ' *' : ''}${i}${f.help ? `<span class="hint">${esc(f.help)}</span>` : ''}</label>`;
}
const formHTML = (fields, v) => `<div class="fgrid">${fields.map((f) => (f.sec ? `<div class="fsec">${esc(f.sec)}</div>` : fld(f, v))).join('')}</div>`;
function readForm(fields, root = document) {
  const o = {};
  for (const f of fields) {
    if (f.sec) continue;
    const el = $('#f_' + f.k, root); if (!el) continue;
    o[f.k] = f.t === 'check' ? +el.checked : f.t === 'money' ? d2c(el.value) : f.t === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  }
  return o;
}
const reqCheck = (fields, o) => { for (const f of fields) if (f.req && !String(o[f.k] ?? '').trim()) { toast(`${f.l} is required`, true); $('#f_' + f.k)?.focus(); return false; } return true; };

// line items editor
function itemsEditor(items, taxRate, id = 'items') {
  const row = (it = { desc: '', qty: 1, unit_cents: 0 }) => `<tr><td><input data-k="desc" value="${esc(it.desc)}" placeholder="Description"></td><td style="width:70px"><input data-k="qty" type="number" step="0.5" min="0" value="${it.qty}"></td><td style="width:120px"><input data-k="price" type="number" step="0.01" value="${c2d(it.unit_cents)}"></td><td style="width:100px" class="r mut amt"></td><td style="width:34px"><button type="button" class="btn sm danger rm" aria-label="Remove line">×</button></td></tr>`;
  return `<table class="items" id="${id}"><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th class="r">Amount</th><th></th></tr></thead><tbody>${(items?.length ? items : [undefined]).map(row).join('')}</tbody></table><button type="button" class="btn sm" id="${id}_add" style="margin-top:6px">+ Add line</button><div class="tots" id="${id}_t"></div><template id="${id}_tpl">${row()}</template>`;
}
function wireItems(root, getTax, id = 'items') {
  const t = $('#' + id, root);
  const calc = () => {
    let sub = 0;
    $$('tbody tr', t).forEach((tr) => { const q = parseFloat($('[data-k=qty]', tr).value) || 0, p = parseFloat($('[data-k=price]', tr).value) || 0; sub += Math.round(q * p * 100); $('.amt', tr).textContent = usd(Math.round(q * p * 100)); });
    const rate = Number(getTax()) || 0, tax = Math.round(sub * rate / 100);
    $('#' + id + '_t', root).innerHTML = `<div class="mut">Subtotal ${usd(sub)}</div>${rate ? `<div class="mut">Tax (${rate}%) ${usd(tax)}</div>` : ''}<div>Total <b>${usd(sub + tax)}</b></div>`;
  };
  t.addEventListener('input', calc);
  $('#' + id + '_add', root).onclick = () => { $('tbody', t).insertAdjacentHTML('beforeend', $('#' + id + '_tpl', root).innerHTML); calc(); };
  t.addEventListener('click', (e) => { if (e.target.closest('.rm')) { if ($$('tbody tr', t).length > 1) e.target.closest('tr').remove(); calc(); } });
  calc();
  return calc;
}
const readItems = (root, id = 'items') => $$('#' + id + ' tbody tr', root).map((tr) => ({ desc: $('[data-k=desc]', tr).value.trim(), qty: parseFloat($('[data-k=qty]', tr).value) || 0, unit_cents: d2c($('[data-k=price]', tr).value) })).filter((i) => i.desc || i.unit_cents);

// ---------- table ----------
function table(cols, rows, { onClick, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tblwrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr ${onClick ? `class="click" data-i="${i}"` : ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-l="${esc(c.h)}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function bindRows(root, rows, fn) { $$('tbody tr.click', root).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('a,button')) return; fn(rows[+tr.dataset.i]); })); }
const chips = (list, cur, id = 'chips') => `<div class="chips" id="${id}">${list.map(([k, l]) => `<button class="chip ${k === cur ? 'on' : ''}" data-k="${k}">${esc(l)}</button>`).join('')}</div>`;

// ---------- app state ----------
const S = { L: {}, me: null, settings: null, view: null };
async function lookups() {
  const [customers, vehicles, drivers, vendors] = await Promise.all(['customers', 'vehicles', 'drivers', 'vendors'].map((r) => GET('/' + r + '?limit=1000')));
  S.L = { customers, vehicles, drivers, vendors };
}
const custOpts = () => opts(S.L.customers, (c) => `${c.name}${c.company ? ', ' + c.company : ''}${c.email ? ' (' + c.email + ')' : ''}`, 'Select customer…');
const vehOpts = () => opts(S.L.vehicles.filter((v) => v.active), (v) => `${v.name} (${v.capacity})`, 'Not specified');
const drvOpts = () => opts(S.L.drivers.filter((d) => d.active), (d) => d.name, 'Unassigned');
const vndOpts = () => opts(S.L.vendors.filter((v) => v.active), (v) => v.name, 'Own / none');

// ---------- nav ----------
const NAV = [
  ['', 'Overview'], ['dashboard', 'Dashboard'], ['analytics', 'Analytics'],
  ['', 'Sales'], ['leads', 'Leads', 'new_leads'], ['quotes', 'Quotes'], ['customers', 'Customers'], ['followups', 'Follow-ups', 'due_fu'],
  ['', 'Operations'], ['trips', 'Trips'], ['drivers', 'Drivers'], ['fleet', 'Fleet'],
  ['', 'Vendors'], ['vendors', 'Vendors'], ['rfqs', 'Vendor quotes', 'rfqs_waiting'],
  ['', 'Money'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['contracts', 'Contracts'],
  ['', 'Other'], ['inbox', 'Inbox', 'unread_messages'], ['chesky', 'Chesky'], ['messages', 'Sent messages'], ['activity', 'Activity'], ['settings', 'Settings'],
];
const VIEWS = {};
function renderNav(counts = {}) {
  const cur = location.hash.replace('#/', '').split('/')[0] || 'dashboard';
  $('#nav').innerHTML = NAV.map(([k, l, c]) => (k === '' ? `<div class="grp">${l}</div>` : `<a href="#/${k}" class="${k === cur ? 'on' : ''}">${l}${counts[c] ? `<span class="n">${counts[c]}</span>` : ''}</a>`)).join('');
}
async function refreshCounts() { try { const d = await GET('/dashboard'); S.counts = { new_leads: d.new_leads, due_fu: d.followups_due.length, rfqs_waiting: d.rfqs_waiting, unread_messages: d.unread_messages }; renderNav(S.counts); } catch {} }
async function route() {
  const name = location.hash.replace('#/', '').split('/')[0] || 'dashboard';
  const v = VIEWS[name] || VIEWS.dashboard;
  S.view = name;
  $('#side').classList.remove('open');
  $('#title').textContent = NAV.find((n) => n[0] === name)?.[1] || 'Dashboard';
  $('#barx').innerHTML = `<a class="btn sm" href="/api/admin/export/all" download title="One workbook with every table">Export everything (Excel)</a>`;
  renderNav(S.counts);
  const el = $('#view'); el.innerHTML = '<div class="empty">Loading…</div>';
  try { await v(el); } catch (e) { if (e.message !== 'Signed out') el.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  refreshCounts();
}
const reload = () => route();
const refresh = async () => { await lookups(); await route(); };

// ---------- dashboard ----------
VIEWS.dashboard = async (el) => {
  const d = await GET('/dashboard');
  const tile = (l, v, s, href, warn) => `<a class="tile ${warn ? 'warn' : ''}" href="${href}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></a>`;
  el.innerHTML = `<div class="tiles">
  ${tile('New leads', d.new_leads, 'waiting for a quote', '#/leads', d.new_leads > 0)}
  ${tile('Quotes out', d.quotes_out.c, usd(d.quotes_out.v) + ' pending', '#/quotes')}
  ${tile('Unpaid invoices', usd(d.unpaid.v), `${d.unpaid.c} open${d.overdue ? `, ${d.overdue} overdue` : ''}`, '#/invoices', d.overdue > 0)}
  ${tile('Collected this month', usd(d.revenue_mtd), '', '#/payments')}
  ${tile('Trips next 7 days', d.trips_week.length, d.unassigned ? `${d.unassigned} need driver/vehicle` : 'all assigned', '#/trips', d.unassigned > 0)}
  ${tile('Vendor replies', d.rfqs_waiting, 'to review', '#/rfqs')}</div>
  <div class="cols"><div class="panel"><h3>Next 7 days</h3>${table([{ h: 'When', f: (t) => fmt(t.depart_at) }, { h: 'Customer', f: (t) => esc(t.customer_name) }, { h: 'Route', f: (t) => `${esc(t.pickup || '')} → ${esc(t.dropoff || '')}` }, { h: 'Driver', f: (t) => (t.driver_name ? esc(t.driver_name) : '<span class="badge b-r">none</span>') }, { h: 'Status', f: (t) => badge(t.status) }], d.trips_week, { onClick: 1, empty: 'No trips scheduled.' })}</div>
  <div class="panel"><h3>Follow-ups due <a href="#/followups" class="sm">All →</a></h3>${table([{ h: 'Task', f: (f) => esc(f.subject || f.kind) }, { h: 'Due', f: (f) => ago(f.due_at) }], d.followups_due, { empty: 'Nothing due. 🎉' })}</div></div>
  <div class="panel"><h3>Recent activity</h3>${table([{ h: 'When', f: (a) => ago(a.at) }, { h: 'Who', f: (a) => esc(a.actor) }, { h: 'What', f: (a) => esc(a.action) }, { h: 'Detail', f: (a) => esc(a.detail) }], d.activity)}</div>`;
  const tripsTbl = $('.cols .panel', el); bindRows(tripsTbl, d.trips_week, (t) => tripModal(t.id));
};

// ---------- analytics ----------
VIEWS.analytics = async (el) => {
  const [a, tr] = await Promise.all([GET('/analytics'), GET('/traffic?days=30')]);
  const bars = (rows, key, cls = '', fmtv = (x) => x) => { const max = Math.max(1, ...rows.map((r) => r[key])); return `<div class="bars">${rows.map((r) => `<div class="b ${cls}" title="${esc(r.m)}: ${fmtv(r[key])}"><em>${fmtv(r[key])}</em><i style="height:${Math.max(2, (r[key] / max) * 100)}%"></i><span>${esc(r.m.slice(2))}</span></div>`).join('')}</div>`; };
  const hb = (rows, vf = (r) => r.c, cls = '') => { const max = Math.max(1, ...rows.map((r) => Number(vf(r)) || 0)); return rows.length ? rows.map((r) => `<div class="hbar ${cls}"><span>${esc(r.k)}</span><div><i style="width:${((Number(vf(r)) || 0) / max) * 100}%"></i></div><b>${esc(r.label ?? vf(r))}</b></div>`).join('') : '<p class="mut">No data yet.</p>'; };
  const f = a.funnel, pct = (x, y) => (y ? Math.round((x / y) * 100) + '%' : '-');
  const mg = a.margin.rev - a.margin.cost;
  el.innerHTML = `<div class="tiles">
   <div class="tile"><div class="l">Quote win rate</div><div class="v">${Math.round(a.win_rate * 100)}%</div><div class="s">${f.accepted} of ${f.quoted} quotes</div></div>
   <div class="tile"><div class="l">Avg quote</div><div class="v">${usd(a.quoteStats.avg)}</div><div class="s">${a.quoteStats.n} sent</div></div>
   <div class="tile"><div class="l">Open receivables</div><div class="v">${usd(a.ar.open)}</div><div class="s">${usd(a.ar.overdue)} overdue</div></div>
   <div class="tile"><div class="l">Vendor margin</div><div class="v">${usd(mg)}</div><div class="s">${a.margin.rev ? Math.round((mg / a.margin.rev) * 100) : 0}% on vendor trips</div></div>
   <div class="tile"><div class="l">Vendor reply rate</div><div class="v">${pct(a.vendorResp.replied || 0, a.vendorResp.sent)}</div><div class="s">${a.vendorResp.replied || 0} of ${a.vendorResp.sent} RFQs</div></div></div>
  <div class="cols"><div class="panel"><h3>Money collected by month</h3>${bars(a.revenue, 'c', '', (c) => '$' + Math.round(c / 100).toLocaleString())}</div>
  <div class="panel"><h3>Leads by month</h3>${bars(a.leads, 'c', 'lime')}</div>
  <div class="panel"><h3>Sales funnel</h3>${hb([{ k: 'Leads', c: f.leads }, { k: 'Quoted', c: f.quoted, label: `${f.quoted} (${pct(f.quoted, f.leads)})` }, { k: 'Accepted', c: f.accepted, label: `${f.accepted} (${pct(f.accepted, f.quoted)})` }, { k: 'Completed', c: f.completed }], (r) => r.c, 'bl')}</div>
  <div class="panel"><h3>Lead sources</h3>${hb(a.bySource)}<h3 style="margin-top:16px">Referred by</h3>${hb(a.byRef)}</div>
  <div class="panel"><h3>Top vehicles</h3>${hb(a.topVehicles.map((r) => ({ ...r, label: `${r.c} · ${usd(r.rev)}` })), (r) => r.c)}</div>
  <div class="panel"><h3>Top customers</h3>${hb(a.topCustomers.map((r) => ({ ...r, label: usd(r.rev) })), (r) => r.rev, 'bl')}</div>
  <div class="panel"><h3>Website traffic · 30 days <span class="mut sm">${tr.totals.visitors} visitors · ${tr.totals.views} page views</span></h3>${bars(tr.daily.map((d) => ({ m: d.day.slice(5), c: d.visitors })), 'c', '')}<h3 style="margin-top:14px">Top pages</h3>${hb(tr.pages)}<h3 style="margin-top:14px">Where visitors come from</h3>${hb(tr.refs, (r) => r.c, 'bl')}<h3 style="margin-top:14px">Devices</h3>${hb(tr.devices)}</div>
  <div class="panel"><h3>Vendors by volume</h3>${table([{ h: 'Vendor', f: (r) => esc(r.k) }, { h: 'Trips', f: (r) => r.c, cls: 'r' }, { h: 'Cost', f: (r) => usd(r.cost), cls: 'r' }, { h: 'Revenue', f: (r) => usd(r.rev), cls: 'r' }, { h: 'Margin', f: (r) => usd(r.rev - r.cost), cls: 'r' }], a.topVendors)}</div></div>`;
};

// ---------- customers ----------
const exportBtn = (kind, label = 'Export to Excel') => `<a class="btn" href="/api/admin/export/${kind}" download>${label}</a>`;
function placesFor(root) { $$('input[data-places]', root).forEach((i) => attachPlaces(i)); }
const KIND_OPTS = Object.entries(KIND_LABELS).map(([k, l]) => [k, l]);
const purposeOpts = () => [['', '(select)'], ...(S.settings?.trip_purposes || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => [x, x])];
const legacyItin = (t) => (t.itinerary && t.itinerary.length ? t.itinerary : [t.pickup && { kind: 'pickup', address: t.pickup, time: t.depart_at }, t.dropoff && { kind: 'dropoff', address: t.dropoff }].filter(Boolean));
const itinList = (it) => (it && it.length ? it.map((x, i) => `${i + 1}. <span class="mut">${esc(KIND_LABELS[x.kind] || x.kind)}</span> ${esc(x.address)}${x.time ? ` <span class="mut">@ ${fmt(x.time)}</span>` : ''}${x.wait_min ? ` <span class="mut">(wait ${x.wait_min}m)</span>` : ''}`).join('<br>') : '-');
function itemRowHTML(it) { return `<tr><td><input data-k="desc" value="${esc(it.desc)}" placeholder="Description"></td><td style="width:70px"><input data-k="qty" type="number" step="0.5" min="0" value="${it.qty}"></td><td style="width:120px"><input data-k="price" type="number" step="0.01" value="${c2d(it.unit_cents)}"></td><td style="width:100px" class="r mut amt"></td><td style="width:34px"><button type="button" class="btn sm danger rm" aria-label="Remove line">×</button></td></tr>`; }
/** Route tools shared by the quote and trip editors: bus-safe drive time with ETAs, and unpriced lines. Never sets a price. */
function wireRouteTools(ov, ed, { purpose, onLines, vehicle, depart }) {
  const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  $('#rt_est', ov)?.addEventListener('click', () => guard(async () => {
    const res = $('#rt_res', ov); res.innerHTML = '<span class="mut">Working out the route...</span>';
    const rows = ed.get();
    if (rows[0] && !rows[0].time && depart?.()) rows[0].time = depart();
    const r = await POST('/route-estimate', { itinerary: rows, vehicle_id: vehicle?.() || null });
    const banner = r.bus_aware ? `<div class="alert-ok">Bus-safe route (${esc(r.provider)}): avoids roads closed to buses, sized for your coach settings.</div>` : `<div class="alert-warn">${esc(r.warning || 'Not bus aware.')}${r.mode === 'car' && !r.warning ? ' Car route for a limo or sprinter.' : ''}</div>`;
    const legsHtml = r.legs.map((l, i) => `<tr><td>${i + 1} to ${i + 2}</td><td>${esc(l.to)}</td><td class="r">${l.miles} mi</td><td class="r">${hm(l.minutes)}</td><td class="r">${r.stops?.[i + 1] ? esc(fmt(r.stops[i + 1].arrive)) + (r.stops[i + 1].late ? ' <span class="badge b-r">late</span>' : '') : ''}</td></tr>`).join('');
    res.innerHTML = `${banner}<p style="margin:6px 0"><b>${r.miles} mi</b>, <b>${hm(r.minutes)}</b> driving, not counting waits. Use it as a guide when you price.</p><div class="tblwrap"><table class="tbl"><thead><tr><th>Leg</th><th>To</th><th class="r">Distance</th><th class="r">Drive</th><th class="r">Arrive</th></tr></thead><tbody>${legsHtml}</tbody></table></div>${r.stops ? '<p style="margin:8px 0 0"><button type="button" class="btn sm" id="rt_fill">Fill empty stop times with these arrivals</button></p>' : '<p class="hint">Set a pickup time on the first stop to get arrival times.</p>'}`;
    $('#rt_fill', res)?.addEventListener('click', () => { const cur = ed.get(); ed.set(cur.map((x, i) => ({ ...x, time: x.time || r.stops[i]?.arrive || '' }))); toast('Times filled in. Adjust any you like.'); });
  }));
  $('#rt_lines', ov)?.addEventListener('click', () => guard(async () => { const lines = await POST('/itinerary/lines', { itinerary: ed.get(), purpose: purpose() }); onLines(lines); toast('Lines added. Enter your prices.'); }));
}

const smsTypesHTML = (c) => { const chosen = (() => { try { return JSON.parse(c.sms_types || 'null'); } catch { return null; } })(); const g = S.cfg?.sms_groups || {}; return `<div class="fsec" style="margin-top:14px">Texts this customer wants (when "OK to text" is checked)</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${Object.entries(g).map(([k, l]) => `<label style="flex-direction:row;display:flex;gap:6px;align-items:center;font-weight:500"><input type="checkbox" data-sg="${k}" ${!chosen || chosen.includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>`; };
const readSmsTypes = (root) => { const all = $$('[data-sg]', root); const on = all.filter((x) => x.checked).map((x) => x.dataset.sg); return on.length === all.length || !on.length ? null : on; };
function composeText({ customer_id, name, phone }) {
  modal({ title: `Text ${name}`, small: true, body: `<p class="mut sm">To ${esc(phone)}. Only works if they agreed to texts.</p><label>Message<textarea id="tm" rows="6" maxlength="500" placeholder="Type your message. Line breaks are kept."></textarea></label><div class="hint" id="tc">0 / 500 (about 160 characters per text)</div>`, footer: `<span class="sp"></span>${button('Send text', 'primary', 'id="go"')}`, onMount(ov, close) {
    $('#tm', ov).oninput = (e) => { $('#tc', ov).textContent = `${e.target.value.length} / 500 (about 160 characters per text)`; };
    $('#go', ov).onclick = () => guard(async () => { const m = $('#tm', ov).value.trim(); if (!m) return toast('Write a message', true); await POST(`/customers/${customer_id}/text`, { message: m }); close(); }, 'Text sent');
  } });
}
const CUST_F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'company', l: 'Company / organization' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'address', l: 'Address', full: 1, places: 1 }, { k: 'sms_optin', l: 'OK to text (customer agreed)', t: 'check' }, { k: 'tags', l: 'Tags', help: 'comma separated, e.g. camp, shul, repeat' }, { k: 'notes', l: 'Internal notes', t: 'textarea', full: 1 }];
async function customerModal(id, after) {
  const c = id ? await GET('/customers/' + id) : {};
  const h = id ? await GET(`/customers/${id}/history`) : null;
  const m = modal({
    title: id ? c.name : 'New customer', body: formHTML(CUST_F, c) + smsTypesHTML(c) + (h ? `<div class="fsec" style="margin-top:20px">History</div><div class="kv"><div><dt>Trips</dt><dd>${h.trips.length}</dd></div><div><dt>Quotes</dt><dd>${h.quotes.length}</dd></div><div><dt>Invoiced</dt><dd>${usd(h.invoices.reduce((s, i) => s + i.total_cents, 0))}</dd></div><div><dt>Outstanding</dt><dd>${usd(h.invoices.filter((i) => ['sent', 'partial'].includes(i.status)).reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0))}</dd></div></div><p>${h.trips.map((t) => `<a href="#" data-trip="${t.id}">${esc(t.ref)}</a> ${fmt(t.depart_at)} ${badge(t.status)}`).join('<br>')}</p>` : ''),
    footer: `${id ? button('Delete', 'danger', 'id="del"') : ''}<span class="sp"></span>${id && c.email ? button('Email…', '', 'id="mail"') : ''}${id && c.phone && c.sms_optin ? button('Text…', '', 'id="txt"') : ''}${id ? button('New quote', '', 'id="nq"') : ''}${button('Save', 'primary', 'id="save"')}`,
    onMount(ov, close) {
      placesFor(ov);
      $('#txt', ov)?.addEventListener('click', () => composeText({ customer_id: id, name: c.name, phone: c.phone }));
      $('#save', ov).onclick = () => guard(async () => { const o = readForm(CUST_F, ov); if (!reqCheck(CUST_F, o)) return; o.sms_types = readSmsTypes(ov); id ? await PUT('/customers/' + id, o) : await POST('/customers', o); close(); await refresh(); after?.(); }, 'Saved');
      if (id) {
        $('#del', ov).onclick = () => guard(async () => { if (!confirm('Delete this customer?')) return; await DEL('/customers/' + id); close(); await refresh(); }, 'Deleted');
        $('#nq', ov).onclick = () => { close(); quoteModal(null, { customer_id: id }); };
        $('#mail', ov)?.addEventListener('click', () => composeEmail({ to: c.email, entity_type: 'customer', entity_id: id }));
        ov.addEventListener('click', (e) => { const a = e.target.closest('[data-trip]'); if (a) { e.preventDefault(); close(); tripModal(+a.dataset.trip); } });
      }
    },
  });
}
VIEWS.customers = async (el) => {
  const draw = async (q = '') => {
    const rows = await GET('/customers?limit=500' + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#list', el).innerHTML = table([{ h: 'Name', f: (c) => `<span class="bold">${esc(c.name)}</span>${c.company ? `<br><span class="mut sm">${esc(c.company)}</span>` : ''}` }, { h: 'Email', f: (c) => esc(c.email) }, { h: 'Phone', f: (c) => esc(c.phone) }, { h: 'Trips', f: (c) => c.trip_count, cls: 'r' }, { h: 'Tags', f: (c) => esc(c.tags) }], rows, { onClick: 1, empty: 'No customers yet.' });
    bindRows($('#list', el), rows, (c) => customerModal(c.id));
  };
  el.innerHTML = `<div class="toolbar"><input type="search" id="q" placeholder="Search name, email, phone…">${button('+ Customer', 'primary', 'id="new"')}${exportBtn('customers')}</div><div id="list"></div>`;
  $('#new', el).onclick = () => customerModal();
  let tm; $('#q', el).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => draw(e.target.value), 250); };
  await draw();
};

// ---------- leads ----------
const LEAD_STATUS = [['', 'All'], ['new', 'New'], ['quoting', 'Quoting'], ['quoted', 'Quoted'], ['converted', 'Booked'], ['lost', 'Lost']];
VIEWS.leads = async (el) => {
  let st = 'new'; let q = '';
  const draw = async () => {
    const rows = await GET('/requests?limit=500' + (st ? '&status=' + st : '') + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#list', el).innerHTML = table([{ h: 'Ref', f: (r) => esc(r.ref) }, { h: 'Customer', f: (r) => `<span class="bold">${esc(r.name)}</span><br><span class="mut sm">${esc(r.email || r.phone)}</span>` }, { h: 'Trip', f: (r) => { const d = J(r.details); return `${esc(d.pickup || '')} → ${esc(d.dropoff || '')}<br><span class="mut sm">${fmt(d.depart_at)} · ${d.passengers || '?'} pax</span>`; } }, { h: 'Source', f: (r) => esc(r.source) }, { h: 'Received', f: (r) => ago(r.created_at) }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No leads in this view.' });
    bindRows($('#list', el), rows, (r) => leadModal(r));
  };
  el.innerHTML = `<div class="toolbar">${chips(LEAD_STATUS, st)}<input type="search" id="q" placeholder="Search…">${button('+ Add lead', 'primary', 'id="new"')}${exportBtn('leads')}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#new', el).onclick = () => manualLead();
  await draw();
};
function manualLead() {
  const F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'company', l: 'Organization' }, { k: 'purpose', l: 'Purpose', t: 'select', o: purposeOpts() }, { k: 'passengers', l: 'Passengers', t: 'number' }, { k: 'depart_at', l: 'Departure', t: 'datetime' }, { k: 'return_at', l: 'Return', t: 'datetime' }, { k: 'vehicle_id', l: 'Vehicle', t: 'select', o: vehOpts() }, { k: '_i', t: 'custom', html: '<div class="fsec">Route</div><div id="itn_box"></div>' }, { k: 'comments', l: 'Notes', t: 'textarea', full: 1 }];
  modal({ title: 'Add lead (phone / walk-in)', body: formHTML(F), footer: `<span class="sp"></span>${button('Save lead', 'primary', 'id="s"')}`, onMount(ov, close) {
    const ed = itineraryEditor($('#itn_box', ov), { staff: false, roundTrip: true });
    $('#s', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; if (!o.email && !o.phone) return toast('Phone or email required', true); const it = ed.get(); if (!it.length) return toast('Add at least a pickup and destination', true); await POST('/requests/manual', { ...o, itinerary: it, trip_type: it.some((x) => x.kind === 'return_pickup') ? 'round_trip' : 'one_way' }); close(); await refresh(); }, 'Lead added'); } });
}
function leadModal(r) {
  const d = J(r.details);
  const v = S.L.vehicles.find((x) => x.id === d.vehicle_id);
  modal({
    title: `${r.ref} - ${r.name}`, body: `<dl class="kv"><div><dt>Contact</dt><dd>${esc(r.name)}<br>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a><br>` : ''}${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}</dd></div><div><dt>Purpose</dt><dd>${esc(d.purpose || '-')}</dd></div><div style="grid-column:1/-1"><dt>Route</dt><dd style="font-weight:500">${itinList(legacyItin(d))}</dd></div><div><dt>Departure</dt><dd>${fmt(d.depart_at)}</dd></div><div><dt>Return</dt><dd>${fmt(d.return_at)}</dd></div><div><dt>Passengers</dt><dd>${d.passengers || '-'}</dd></div><div><dt>Vehicle</dt><dd>${esc(v?.name || d.vehicle_pref || 'No preference')}</dd></div><div><dt>Type</dt><dd>${esc(d.trip_type || '')}</dd></div><div><dt>Source</dt><dd>${esc(r.source)}${r.referred_by ? ` · via ${esc(r.referred_by)}` : ''}</dd></div></dl>
    ${d.comments ? `<p><b>Customer notes:</b><br>${esc(d.comments)}</p>` : ''}<div class="fgrid" style="margin-top:12px"><label>Status<select id="st">${['new', 'quoting', 'quoted', 'converted', 'lost'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Internal notes<textarea id="nt">${esc(r.notes || '')}</textarea></label></div>`,
    footer: `${button('Delete', 'danger', 'id="del"')}<span class="sp"></span>${button('Request vendor prices', '', 'id="rfq"')}${button('Save', '', 'id="save"')}${button('Create quote →', 'primary', 'id="mkq"')}`,
    onMount(ov, close) {
      $('#save', ov).onclick = () => guard(async () => { await PUT('/requests/' + r.id, { status: $('#st', ov).value, notes: $('#nt', ov).value }); close(); reload(); }, 'Saved');
      $('#del', ov).onclick = () => guard(async () => { if (!confirm('Delete this lead?')) return; await DEL('/requests/' + r.id); close(); reload(); });
      $('#mkq', ov).onclick = () => guard(async () => { const x = await POST(`/requests/${r.id}/quote`); close(); await refresh(); quoteModal(x.quote_id); });
      $('#rfq', ov).onclick = () => rfqModal({ request_id: r.id, label: `${r.ref} ${d.pickup || ''} → ${d.dropoff || ''}` });
    },
  });
}

// ---------- quotes ----------
const QUOTE_ST = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined']];
VIEWS.quotes = async (el) => {
  let st = ''; let q = '';
  const draw = async () => {
    const rows = await GET('/quotes?limit=500' + (st ? '&status=' + st : '') + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#list', el).innerHTML = table([{ h: 'Quote', f: (r) => `<span class="bold">${esc(r.number)}</span>` }, { h: 'Customer', f: (r) => esc(r.customer_name) }, { h: 'Trip', f: (r) => `${esc(r.title || '')}<br><span class="mut sm">${fmt(J(r.trip).depart_at)}</span>` }, { h: 'Total', f: (r) => usd(r.total_cents), cls: 'r' }, { h: 'Sent', f: (r) => (r.sent_at ? ago(r.sent_at) : '-') }, { h: 'Viewed', f: (r) => (r.viewed_at ? ago(r.viewed_at) : '-') }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No quotes yet. Create one from a lead.' });
    bindRows($('#list', el), rows, (r) => quoteModal(r.id));
  };
  el.innerHTML = `<div class="toolbar">${chips(QUOTE_ST, st)}<input type="search" id="q" placeholder="Search…">${button('+ New quote', 'primary', 'id="new"')}${exportBtn('quotes')}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#new', el).onclick = () => quoteModal();
  await draw();
};
const tripScalars = () => [
  { k: 'purpose', l: 'Trip purpose', t: 'select', o: purposeOpts() }, { k: 'passengers', l: 'Passengers', t: 'number' },
  { k: 'depart_at', l: 'Departure', t: 'datetime' }, { k: 'return_at', l: 'Return', t: 'datetime' }, { k: 'vehicle_id', l: 'Vehicle', t: 'select', o: vehOpts() },
];
const routeBlock = `<div class="fsec">Route, every start, pickup, stop and drop-off, in order</div><div id="itn_box"></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn sm" id="rt_est">Estimate drive time</button><button type="button" class="btn sm" id="rt_lines">Add pricing lines from route</button><span class="hint" id="rt_out">Pricing is always entered by you. These only create empty lines to fill in.</span></div><div id="rt_res" style="margin-top:10px"></div>`;
async function quoteModal(id, preset = {}) {
  const q = id ? await GET('/quotes/' + id) : { items: '[]', tax_rate: Number(S.settings?.tax_rate) || 0, deposit_pct: Number(S.settings?.deposit_pct) || 50, status: 'draft', trip: '{}', valid_until: new Date(Date.now() + (Number(S.settings?.quote_valid_days) || 7) * 864e5).toISOString().slice(0, 10), ...preset };
  const trip = J(q.trip); const items = J(q.items); const tf = tripScalars();
  const F = [{ k: 'customer_id', l: 'Customer', t: 'select', o: custOpts(), req: 1 }, { k: 'title', l: 'Title', help: 'Shown to the customer, e.g. "Camp Sample visiting day"' }, { sec: 'Trip' }, ...tf, { k: '_r', t: 'custom', html: routeBlock }, { k: 'tnotes', l: 'Trip notes (shared with driver & vendors)', t: 'textarea', full: 1, def: trip.notes }, { sec: 'Pricing (you enter every price)' }];
  const F2 = [{ k: 'tax_rate', l: 'Tax %', t: 'number', step: 0.001 }, { k: 'deposit_pct', l: 'Deposit % due to book', t: 'number', step: 1 }, { k: 'valid_until', l: 'Valid until', t: 'date' }, { k: 'notes', l: 'Note to customer (shown on quote)', t: 'textarea', full: 1 }];
  const locked = id && ['accepted'].includes(q.status);
  modal({
    title: id ? `${q.number}` : 'New quote',
    body: `<div style="margin-bottom:10px">${id ? badge(q.status) + (q.viewed_at ? ` <span class="mut sm">viewed ${ago(q.viewed_at)}</span>` : '') : ''} <button class="link sm" id="newcust" type="button">+ new customer</button></div>${formHTML(F, { ...q, ...trip })}${itemsEditor(items, q.tax_rate)}<div style="margin-top:14px">${formHTML(F2, q)}</div>`,
    footer: `${id && q.status === 'draft' ? button('Delete', 'danger', 'id="del"') : ''}${id ? button('Duplicate', '', 'id="dup"') : ''}${id ? button('Copy customer link', '', 'id="lnk"') : ''}<span class="sp"></span>${id && !locked ? button('Mark accepted', '', 'id="acc"') : ''}${button('Save', '', 'id="save"')}${button(q.status === 'sent' ? 'Re-send' : 'Send to customer', 'primary', 'id="send"')}`,
    onMount(ov, close) {
      const ed = itineraryEditor($('#itn_box', ov), { staff: true, value: legacyItin(trip) });
      const calc = wireItems(ov, () => $('#f_tax_rate', ov).value);
      wireRouteTools(ov, ed, { vehicle: () => $('#f_vehicle_id', ov).value, depart: () => $('#f_depart_at', ov).value, purpose: () => $('#f_purpose', ov).value, onLines: (lines) => { const cur = readItems(ov); const have = new Set(cur.map((x) => x.desc)); const add = lines.filter((l) => !have.has(l.desc)); $('#items tbody', ov).insertAdjacentHTML('beforeend', add.map(itemRowHTML).join('')); calc(); } });
      $('#f_tax_rate', ov).addEventListener('input', () => $('#items', ov).dispatchEvent(new Event('input')));
      $('#newcust', ov).onclick = () => customerModal(null, async () => { await lookups(); });
      const collect = () => {
        const o = readForm([...F, ...F2], ov); if (!o.customer_id) { toast('Select a customer', true); return null; }
        if (o.depart_at && new Date(o.depart_at.slice(0, 16) + ':00Z').getUTCDay() === 6 && !confirm('This trip starts on a Saturday. Shabbos trips usually start after Shabbos ends. Keep this time?')) return null;
        const t = { notes: o.tnotes, purpose: o.purpose, passengers: o.passengers, depart_at: o.depart_at, return_at: o.return_at, vehicle_id: Number(o.vehicle_id) || null, itinerary: ed.get() };
        return { customer_id: Number(o.customer_id), title: o.title, tax_rate: o.tax_rate, deposit_pct: o.deposit_pct, valid_until: o.valid_until, notes: o.notes, items: readItems(ov), trip: t };
      };
      const save = async () => { const body = collect(); if (!body) return null; if (id) { await PUT('/quotes/' + id, body); return id; } const r = await POST('/quotes', { ...body, request_id: preset.request_id }); return r.id; };
      $('#save', ov).onclick = () => guard(async () => { if (await save()) { close(); reload(); } }, 'Saved');
      $('#send', ov).onclick = () => guard(async () => { const qid = await save(); if (!qid) return; await POST(`/quotes/${qid}/send`); close(); reload(); }, 'Quote sent to customer');
      if (id) {
        $('#del', ov)?.addEventListener('click', () => guard(async () => { if (!confirm('Delete draft?')) return; await DEL('/quotes/' + id); close(); reload(); }));
        $('#dup', ov).onclick = () => guard(async () => { const r = await POST(`/quotes/${id}/duplicate`); close(); quoteModal(r.id); });
        $('#lnk', ov).onclick = () => guard(async () => { const r = await GET(`/quotes/${id}/link`); await navigator.clipboard?.writeText(r.url).catch(() => {}); prompt('Customer quote link:', r.url); });
        $('#acc', ov)?.addEventListener('click', () => guard(async () => { if (!confirm('Mark as accepted without a signature? This creates the trip and an invoice. (Customers normally accept and sign online.)')) return; await save(); await POST(`/quotes/${id}/accept`); close(); reload(); }, 'Accepted, trip and invoice created'));
      }
    },
  });
}

// ---------- trips ----------
const TRIP_ST = [['', 'All'], ['booked', 'Booked'], ['confirmed', 'Confirmed'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
VIEWS.trips = async (el) => {
  let st = ''; let q = ''; let upcoming = true;
  const draw = async () => {
    const rows = await GET('/trips?limit=500' + (st ? '&status=' + st : '') + (q ? '&q=' + encodeURIComponent(q) : '') + (upcoming ? '&from=' + new Date().toISOString().slice(0, 10) : ''));
    if (upcoming) rows.reverse();
    $('#list', el).innerHTML = table([{ h: 'When', f: (r) => `<span class="bold">${fmt(r.depart_at)}</span>` }, { h: 'Trip', f: (r) => `${esc(r.ref)}<br><span class="mut sm">${esc(r.customer_name)}</span>` }, { h: 'Route', f: (r) => { const n = (J(r.itinerary).length || 2); return `${esc(r.purpose || '')}${r.purpose ? '<br>' : ''}<span class="mut sm">${esc(r.pickup || '')} → ${esc(r.dropoff || '')}${n > 2 ? ` · ${n} stops` : ''}</span>`; } }, { h: 'Vehicle', f: (r) => (r.vehicle_name ? esc(r.vehicle_name) : '<span class="badge b-a">unset</span>') }, { h: 'Driver', f: (r) => (r.driver_name ? esc(r.driver_name) + (r.driver_status ? `<br><span class="mut sm">${esc(r.driver_status.replace('_', ' '))}</span>` : '') : '<span class="badge b-a">unassigned</span>') }, { h: 'Vendor', f: (r) => esc(r.vendor_name || '-') }, { h: 'Price', f: (r) => usd(r.price_cents), cls: 'r' }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No trips.' });
    bindRows($('#list', el), rows, (r) => tripModal(r.id));
  };
  el.innerHTML = `<div class="toolbar">${chips(TRIP_ST, st)}<label style="display:flex;gap:6px;align-items:center;flex-direction:row"><input type="checkbox" id="up" checked> upcoming only</label><input type="search" id="q" placeholder="Search…">${button('+ Trip', 'primary', 'id="new"')}${exportBtn('trips')}${exportBtn('stops', 'Export stops')}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  $('#up', el).onchange = (e) => { upcoming = e.target.checked; draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#new', el).onclick = () => tripModal();
  await draw();
};
async function tripModal(id) {
  const t = id ? await GET(`/trips/${id}/detail`) : { status: 'booked' };
  const F = [{ k: 'customer_id', l: 'Customer', t: 'select', o: custOpts(), req: 1 }, { k: 'status', l: 'Status', t: 'select', o: ['booked', 'confirmed', 'in_progress', 'completed', 'cancelled'].map((s) => [s, s.replace('_', ' ')]) }, { k: 'title', l: 'Title', full: 1 }, ...tripScalars(), { k: 'onsite_name', l: 'On-site contact name', help: 'Person at pickup if not the customer' }, { k: 'onsite_phone', l: 'On-site contact phone', t: 'tel' }, { k: '_r', t: 'custom', html: routeBlock }, { sec: 'Assignment & money' }, { k: 'driver_id', l: 'Driver', t: 'select', o: drvOpts() }, { k: 'vendor_id', l: 'Vendor (operator)', t: 'select', o: vndOpts() }, { k: 'price_cents', l: 'Customer price', t: 'money' }, { k: 'vendor_cost_cents', l: 'Vendor cost', t: 'money' }, { k: 'notes', l: 'Trip notes', t: 'textarea', full: 1 }, { k: 'driver_notes', l: 'Notes for driver', t: 'textarea', full: 1 }];
  const margin = (t.price_cents || 0) - (t.vendor_cost_cents || 0);
  const cons = t.contracts || [];
  modal({
    title: id ? `${t.ref} - ${t.customer?.name || ''}` : 'New trip',
    body: `${id ? `<p class="mut">${badge(t.status)} ${t.driver_status ? `Driver: <b>${esc(t.driver_status.replace('_', ' '))}</b> ${ago(t.driver_status_at)}` : ''} ${t.vendor_id ? `· margin <b>${usd(margin)}</b>` : ''} ${t.maps_url ? `· <a href="${esc(t.maps_url)}" target="_blank" rel="noopener">Open route in Google Maps</a>` : ''}</p>` : ''}${formHTML(F, t)}
    ${id ? `<div class="fsec" style="margin-top:18px">Agreement (e-signature)</div>${cons.length ? cons.map((k) => `<div>${esc(k.number)} ${badge(k.status === 'signed' ? 'accepted' : k.status)} ${usd(k.total_cents)} ${k.status === 'signed' ? `signed by ${esc(k.signer_name)} ${ago(k.signed_at)} · <a href="/api/admin/contracts/${k.id}/pdf" target="_blank">PDF</a>` : `<button class="link" data-send-con="${k.id}">send to customer</button> · <button class="link" data-copy-con="${k.id}">copy link</button>`}</div>`).join('') : '<p class="mut">No agreement yet. Customers sign automatically when they accept a quote online. For other trips, create one:</p>'}<p><button class="btn sm" id="mkcon" type="button">Create agreement to sign</button></p>
    <div class="fsec">Invoices</div>${t.invoices.length ? t.invoices.map((i) => `<div><a href="#" data-inv="${i.id}">${esc(i.number)}</a> ${badge(i.status)} ${usd(i.total_cents)} (paid ${usd(i.amount_paid_cents)})</div>`).join('') : '<p class="mut">None yet.</p>'}
    ${t.rfqs.length ? `<div class="fsec">Vendor quotes</div>${t.rfqs.map((r) => `<div>${esc(r.vendor_name)} ${badge(r.status)} ${r.price_cents ? usd(r.price_cents) : ''}</div>`).join('')}` : ''}
    <div class="fsec">Driver timeline</div><div class="tl">${t.events.length ? t.events.map((e) => `<div><b>${esc(e.status.replace('_', ' '))}</b> <span class="mut sm">${fmt(e.at)}</span>${e.note ? `<br>${esc(e.note)}` : ''}</div>`).join('') : '<span class="mut">No driver updates yet.</span>'}</div>` : ''}`,
    footer: `<span class="sp"></span>${id ? button('Email confirmation', '', 'id="conf"') + button('Request Google review', '', 'id="rev"') + button('Vendor prices', '', 'id="rfq"') + button('Create invoice', '', 'id="inv"') : ''}${button('Save', 'primary', 'id="save"')}`,
    onMount(ov, close) {
      const ed = itineraryEditor($('#itn_box', ov), { staff: true, value: legacyItin(t) });
      wireRouteTools(ov, ed, { vehicle: () => $('#f_vehicle_id', ov).value, depart: () => $('#f_depart_at', ov).value, purpose: () => $('#f_purpose', ov).value, onLines: () => toast('Open a quote or invoice to add the lines') });
      $('#rt_lines', ov).style.display = 'none';
      $('#save', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; o.itinerary = ed.get();
        if (o.depart_at) { const cf = await GET(`/trips/conflicts?id=${id || 0}&from=${encodeURIComponent(o.depart_at)}&to=${encodeURIComponent(o.return_at || '')}&driver_id=${o.driver_id || ''}&vehicle_id=${o.vehicle_id || ''}`); if (cf.length && !confirm(cf.map((c) => `${c.what === 'driver' ? 'This driver' : 'This vehicle'} is already on ${c.ref} (${c.customer_name}, ${fmt(c.depart_at)})`).join('\n') + '\n\nSave anyway?')) return; }
        id ? await PUT('/trips/' + id, o) : await POST('/trips', o); close(); reload(); }, 'Saved');
      if (id) {
        $('#conf', ov).onclick = () => guard(() => POST(`/trips/${id}/confirm-email`), 'Confirmation emailed');
        $('#rev', ov).onclick = () => guard(async () => { const r = await POST(`/trips/${id}/review-request`); toast(r.sms ? 'Review request sent by email and text' : 'Review request emailed'); });
        $('#rfq', ov).onclick = () => rfqModal({ trip_id: id, label: `${t.ref} ${t.pickup || ''} → ${t.dropoff || ''}` });
        $('#inv', ov).onclick = () => guard(async () => { const r = await POST(`/trips/${id}/invoice`); close(); invoiceModal(r.id); });
        $('#mkcon', ov).onclick = () => guard(async () => { const r = await POST('/contracts', { trip_id: id }); await POST(`/contracts/${r.id}/send`); close(); tripModal(id); }, 'Agreement emailed to customer');
        ov.addEventListener('click', (e) => {
          const a = e.target.closest('[data-inv]'); if (a) { e.preventDefault(); close(); invoiceModal(+a.dataset.inv); }
          const sc = e.target.closest('[data-send-con]'); if (sc) guard(() => POST(`/contracts/${sc.dataset.sendCon}/send`), 'Sent');
          const cc = e.target.closest('[data-copy-con]'); if (cc) guard(async () => { const r = await GET(`/contracts/${cc.dataset.copyCon}/link`); prompt('Customer signing link:', r.url); });
        });
      }
    },
  });
}

// ---------- invoices & payments ----------
const INV_ST = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['partial', 'Partial'], ['paid', 'Paid'], ['void', 'Void']];
VIEWS.invoices = async (el) => {
  let st = ''; let q = '';
  const today = new Date().toISOString().slice(0, 10);
  const draw = async () => {
    const rows = await GET('/invoices?limit=500' + (st ? '&status=' + st : '') + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#list', el).innerHTML = table([{ h: 'Invoice', f: (r) => `<span class="bold">${esc(r.number)}</span>` }, { h: 'Customer', f: (r) => esc(r.customer_name) }, { h: 'Title', f: (r) => esc(r.title) }, { h: 'Total', f: (r) => usd(r.total_cents), cls: 'r' }, { h: 'Paid', f: (r) => usd(r.amount_paid_cents), cls: 'r' }, { h: 'Balance', f: (r) => `<b>${usd(r.total_cents - r.amount_paid_cents)}</b>`, cls: 'r' }, { h: 'Due', f: (r) => `${fmt(r.due_date)}${['sent', 'partial'].includes(r.status) && r.due_date < today ? ' <span class="badge b-r">overdue</span>' : ''}` }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No invoices.' });
    bindRows($('#list', el), rows, (r) => invoiceModal(r.id));
  };
  el.innerHTML = `<div class="toolbar">${chips(INV_ST, st)}<input type="search" id="q" placeholder="Search…">${button('+ Invoice', 'primary', 'id="new"')}${exportBtn('invoices')}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#new', el).onclick = () => invoiceModal();
  await draw();
};
async function invoiceModal(id) {
  const i = id ? await GET('/invoices/' + id) : { items: '[]', tax_rate: Number(S.settings?.tax_rate) || 0, status: 'draft', due_date: new Date(Date.now() + (Number(S.settings?.invoice_due_days) || 7) * 864e5).toISOString().slice(0, 10) };
  const pays = id ? await GET(`/invoices/${id}/payments`) : [];
  const F = [{ k: 'customer_id', l: 'Customer', t: 'select', o: custOpts(), req: 1 }, { k: 'title', l: 'Title / description' }, { k: 'tax_rate', l: 'Tax %', t: 'number', step: 0.001 }, { k: 'deposit_cents', l: 'Deposit due now', t: 'money', help: 'Customers can pay this amount or the full balance' }, { k: 'due_date', l: 'Due date', t: 'date' }, { k: 'status', l: 'Status', t: 'select', o: [['draft', 'draft'], ['sent', 'sent (use Send)'], ['void', 'void']] }, { k: 'notes', l: 'Note shown on invoice', t: 'textarea', full: 1 }];
  const bal = (i.total_cents || 0) - (i.amount_paid_cents || 0);
  modal({
    title: id ? i.number : 'New invoice',
    body: `${id ? `<p>${badge(i.status)} <b>${usd(i.total_cents)}</b> total · <b>${usd(i.amount_paid_cents)}</b> paid · balance <b>${usd(bal)}</b></p>` : ''}${formHTML(F, i)}<div style="margin-top:12px">${itemsEditor(J(i.items).length ? J(i.items) : [], i.tax_rate)}</div>
    ${id ? `<div class="fsec" style="margin-top:18px">Payments</div>${pays.length ? table([{ h: 'Date', f: (p) => fmt(p.created_at) }, { h: 'Method', f: (p) => esc(p.method) }, { h: 'Ref', f: (p) => esc(p.reference || '') }, { h: 'Amount', f: (p) => usd(p.amount_cents), cls: 'r' }, { h: 'Status', f: (p) => (p.status === 'authorized' ? '<span class="badge b-a">hold</span>' : p.status === 'released' ? '<span class="badge">released</span>' : p.method === 'refund' ? '<span class="badge b-r">refund</span>' : '<span class="badge b-g">paid</span>') }, { h: '', f: (p) => (p.status === 'authorized' ? `<button class="btn sm primary" data-capture="${p.id}" data-amt="${p.amount_cents}">Capture</button> <button class="btn sm" data-release="${p.id}">Release hold</button>` : p.status === 'succeeded' && p.amount_cents > 0 && p.method !== 'refund' ? `<button class="btn sm danger" data-refund="${p.id}" data-amt="${p.amount_cents}">Refund…</button>` : '') }], pays) : '<p class="mut">No payments yet.</p>'}
    <form id="payf" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:10px"><label>Record payment ($)<input id="pa" type="number" step="0.01" min="0" value="${bal > 0 ? c2d(bal) : ''}" style="width:130px"></label><label>Method<select id="pm"><option>cash</option><option>check</option><option>zelle</option><option>venmo</option><option>wire</option><option>card</option><option>other</option></select></label><label>Reference<input id="pr" style="width:150px"></label><button class="btn sm primary">Record</button></form>
    <form id="authf" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><label>Hold on customer's card ($)<input id="aa" type="number" step="0.01" min="1" value="${bal > 0 ? c2d(bal) : ''}" style="width:130px"></label><label style="flex-direction:row;display:flex;gap:6px;align-items:center;font-weight:500"><input type="checkbox" id="aemail" checked> email the link</label><button class="btn sm">Request card hold</button><span class="hint">Authorizes without charging. Capture all or part later, or release. Holds usually expire in about 7 days.</span></form>` : ''}`,
    footer: `${id && i.status === 'draft' ? button('Delete', 'danger', 'id="del"') : ''}<span class="sp"></span>${id ? button('Copy pay link', '', 'id="lnk"') : ''}${button('Save', '', 'id="save"')}${button(id && i.status !== 'draft' ? 'Re-send' : 'Send to customer', 'primary', 'id="send"')}`,
    onMount(ov, close) {
      wireItems(ov, () => $('#f_tax_rate', ov).value);
      $('#f_tax_rate', ov).addEventListener('input', () => $('#items', ov).dispatchEvent(new Event('input')));
      const save = async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return null; o.items = readItems(ov); if (!o.items.length) { toast('Add at least one line item', true); return null; } if (id) { await PUT('/invoices/' + id, o); return id; } return (await POST('/invoices', o)).id; };
      $('#save', ov).onclick = () => guard(async () => { if (await save()) { close(); reload(); } }, 'Saved');
      $('#send', ov).onclick = () => guard(async () => { const x = await save(); if (!x) return; await POST(`/invoices/${x}/send`); close(); reload(); }, 'Invoice emailed');
      if (id) {
        $('#del', ov)?.addEventListener('click', () => guard(async () => { if (!confirm('Delete draft invoice?')) return; await DEL('/invoices/' + id); close(); reload(); }));
        $('#lnk', ov).onclick = () => guard(async () => { const r = await GET(`/invoices/${id}/link`); await navigator.clipboard?.writeText(r.url).catch(() => {}); prompt('Customer payment link:', r.url); });
        $('#payf', ov).onsubmit = (e) => { e.preventDefault(); guard(async () => { await POST(`/invoices/${id}/payments`, { amount_cents: d2c($('#pa', ov).value), method: $('#pm', ov).value, reference: $('#pr', ov).value }); close(); reload(); }, 'Payment recorded'); };
        ov.addEventListener('click', (e) => {
          const b = e.target.closest('[data-refund]');
          if (b) { const amt = prompt(`Refund amount ($), up to ${c2d(b.dataset.amt)}. Leave as is for a full refund; enter less for a partial refund.`, c2d(b.dataset.amt)); if (!amt) return; guard(async () => { await POST(`/payments/${b.dataset.refund}/refund`, { amount_cents: d2c(amt) }); close(); reload(); }, 'Refund sent'); return; }
          const c = e.target.closest('[data-capture]');
          if (c) { const amt = prompt(`Capture amount ($), up to ${c2d(c.dataset.amt)}. Capturing less releases the rest of the hold.`, c2d(c.dataset.amt)); if (!amt) return; guard(async () => { await POST(`/payments/${c.dataset.capture}/capture`, { amount_cents: d2c(amt) }); close(); reload(); }, 'Captured'); return; }
          const r = e.target.closest('[data-release]');
          if (r && confirm('Release this hold? The customer will not be charged.')) guard(async () => { await POST(`/payments/${r.dataset.release}/release`); close(); reload(); }, 'Hold released');
        });
        $('#authf', ov).onsubmit = (e) => { e.preventDefault(); guard(async () => { const x = await POST(`/invoices/${id}/auth-link`, { amount_cents: d2c($('#aa', ov).value), email: $('#aemail', ov).checked }); if (x.emailed) toast('Authorization link emailed'); else prompt('Send the customer this link (valid 24 hours):', x.url); }); };
      }
    },
  });
}
VIEWS.payments = async (el) => {
  const rows = await GET('/payments');
  const tot = rows.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount_cents, 0);
  el.innerHTML = `<p class="mut">Net received (last 300 entries): <b>${usd(tot)}</b> &nbsp; ${exportBtn('payments')}</p>${table([{ h: 'Date', f: (p) => fmt(p.created_at) }, { h: 'Invoice', f: (p) => esc(p.invoice_number) }, { h: 'Customer', f: (p) => esc(p.customer_name) }, { h: 'Method', f: (p) => esc(p.method) }, { h: 'Reference', f: (p) => esc(p.reference || '') }, { h: 'Amount', f: (p) => `<span style="color:${p.amount_cents < 0 ? 'var(--red)' : 'inherit'}">${usd(p.amount_cents)}</span>`, cls: 'r' }, { h: 'Status', f: (p) => (p.status === 'authorized' ? '<span class="badge b-a">hold</span>' : p.status === 'released' ? '<span class="badge">released</span>' : p.method === 'refund' ? '<span class="badge b-r">refund</span>' : '<span class="badge b-g">paid</span>') }], rows, { empty: 'No payments yet.' })}`;
};

// ---------- vendors / RFQs ----------
const VEND_F = [{ k: 'name', l: 'Company', req: 1 }, { k: 'contact_name', l: 'Contact person' }, { k: 'email', l: 'Email (for quote requests)', t: 'email' }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'vehicle_types', l: 'Vehicles they run', help: 'e.g. 56 coach, 33 party bus, sprinters' }, { k: 'service_area', l: 'Service area' }, { k: 'rating', l: 'Rating (1-5)', t: 'number' }, { k: 'active', l: 'Active', t: 'check' }, { k: 'notes', l: 'Notes (rates, reliability, insurance expiry…)', t: 'textarea', full: 1 }];
VIEWS.vendors = async (el) => {
  const rows = await GET('/vendors');
  el.innerHTML = `<div class="toolbar">${button('+ Vendor', 'primary', 'id="new"')}${exportBtn('vendors')}${exportBtn('rfqs', 'Export vendor quotes')}</div>${table([{ h: 'Vendor', f: (v) => `<span class="bold">${esc(v.name)}</span><br><span class="mut sm">${esc(v.contact_name || '')}</span>` }, { h: 'Email', f: (v) => esc(v.email) }, { h: 'Phone', f: (v) => esc(v.phone) }, { h: 'Vehicles', f: (v) => esc(v.vehicle_types) }, { h: 'Area', f: (v) => esc(v.service_area) }, { h: 'Rating', f: (v) => '★'.repeat(v.rating || 0) }, { h: '', f: (v) => (v.active ? '' : badge('inactive')) }], rows, { onClick: 1, empty: 'Add the bus companies you work with to send them quote requests.' })}`;
  $('#new', el).onclick = () => simpleModal('New vendor', VEND_F, null, '/vendors');
  bindRows(el, rows, (v) => simpleModal(v.name, VEND_F, v, '/vendors'));
};
function simpleModal(title, F, rec, base, extraFooter = '', onMount2) {
  const defaults = rec ? rec : { active: 1 };
  return modal({ title, body: formHTML(F, defaults), footer: `${rec ? button('Delete', 'danger', 'id="del"') : ''}<span class="sp"></span>${extraFooter}${button('Save', 'primary', 'id="save"')}`, onMount(ov, close) {
    $('#save', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; rec ? await PUT(`${base}/${rec.id}`, o) : await POST(base, o); close(); await refresh(); }, 'Saved');
    $('#del', ov)?.addEventListener('click', () => guard(async () => { if (!confirm('Delete?')) return; await DEL(`${base}/${rec.id}`); close(); await refresh(); }, 'Deleted'));
    onMount2?.(ov, close);
  } });
}
function rfqModal({ request_id, trip_id, label }) {
  const vs = S.L.vendors.filter((v) => v.active && v.email);
  modal({
    title: 'Request vendor prices', body: `<p class="mut">${esc(label || '')}</p><p>Vendors receive trip details (no customer contact info) and reply with a price through a private link, no login.</p>${vs.length ? `<div class="chips" style="display:grid;gap:6px;margin-bottom:12px">${vs.map((v) => `<label style="display:flex;gap:8px;align-items:center;flex-direction:row;font-weight:500"><input type="checkbox" value="${v.id}"> <span><b>${esc(v.name)}</b> <span class="mut sm">${esc(v.vehicle_types || '')}</span></span></label>`).join('')}</div>` : '<div class="empty">Add vendors with email addresses first (Vendors page).</div>'}<label>Message to vendors (optional)<textarea id="msg" placeholder="Budget, special requirements, deadline for reply…"></textarea></label>`,
    footer: `<span class="sp"></span>${button('Send requests', 'primary', 'id="go"')}`, small: true,
    onMount(ov, close) { $('#go', ov).onclick = () => guard(async () => { const ids = $$('input[type=checkbox]:checked', ov).map((x) => +x.value); if (!ids.length) return toast('Select at least one vendor', true); const r = await POST('/rfqs', { request_id, trip_id, vendor_ids: ids, message: $('#msg', ov).value }); const bad = r.sent.filter((s) => !s.email.ok).length; close(); toast(bad ? `${r.sent.length - bad} sent, ${bad} failed` : `Sent to ${r.sent.length} vendor(s)`, !!bad); reload(); }); },
  });
}
VIEWS.rfqs = async (el) => {
  let st = '';
  const draw = async () => {
    const rows = await GET('/rfqs' + (st ? '?status=' + st : ''));
    $('#list', el).innerHTML = table([{ h: 'Ref', f: (r) => esc(r.ref) }, { h: 'For', f: (r) => esc(r.request_ref || r.trip_ref || '') }, { h: 'Vendor', f: (r) => `<span class="bold">${esc(r.vendor_name)}</span><br><span class="mut sm">${esc(r.vendor_phone || '')}</span>` }, { h: 'Trip', f: (r) => { const s = J(r.snapshot); return `${esc(s.pickup || '')} → ${esc(s.dropoff || '')}<br><span class="mut sm">${fmt(s.depart_at)} · ${s.passengers || '?'} pax</span>`; } }, { h: 'Price', f: (r) => (r.price_cents ? `<b>${usd(r.price_cents)}</b><br><span class="mut sm">${esc(r.offered_vehicle || '')}</span>` : '-'), cls: 'r' }, { h: 'Notes', f: (r) => esc(r.response_notes || '') }, { h: 'Sent', f: (r) => ago(r.sent_at) }, { h: 'Status', f: (r) => badge(r.status) }, { h: '', f: (r) => (['responded', 'sent'].includes(r.status) && r.price_cents ? `<button class="btn sm primary" data-a="${r.id}">Award</button>` : '') }], rows, { empty: 'No vendor quote requests yet. Send them from a lead or trip.' });
  };
  el.innerHTML = `<div class="toolbar">${chips([['', 'All'], ['sent', 'Waiting'], ['responded', 'Replied'], ['accepted', 'Awarded'], ['declined', 'Declined']], st)}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b && confirm('Award this trip to this vendor at their price? Other requests for the same trip will be closed.')) guard(async () => { await POST(`/rfqs/${b.dataset.a}/accept`); draw(); }, 'Awarded'); });
  await draw();
};

// ---------- fleet ----------
const VEH_F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'category', l: 'Category', t: 'select', o: ['Coach Bus', 'Party Bus', 'Trolley', 'Limo', 'Sprinter / Shuttle', 'Executive Coach', 'Double Decker', 'Other'].map((x) => [x, x]) }, { k: 'capacity', l: 'Seats', t: 'number' }, { k: 'sort', l: 'Sort order', t: 'number', help: 'Lower shows first' }, { k: 'features', l: 'Features', help: 'comma separated', full: 1 }, { k: 'description', l: 'Description (public)', t: 'textarea', full: 1 }, { k: 'active', l: 'Show on website', t: 'check' }];
VIEWS.fleet = async (el) => {
  const rows = await GET('/vehicles');
  el.innerHTML = `<div class="toolbar">${button('+ Vehicle', 'primary', 'id="new"')}${exportBtn('fleet')}<span class="mut sm">Order with the sort number. Upload vehicle photos only: no people in any picture.</span></div>${table([{ h: '', f: (v) => (v.image ? `<img src="${esc(v.image)}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:6px">` : '') }, { h: 'Vehicle', f: (v) => `<span class="bold">${esc(v.name)}</span>` }, { h: 'Category', f: (v) => esc(v.category) }, { h: 'Seats', f: (v) => v.capacity, cls: 'r' }, { h: 'Order', f: (v) => v.sort, cls: 'r' }, { h: 'Site', f: (v) => (v.active ? badge('live') : badge('hidden')) }], rows, { onClick: 1 })}`;
  $('#new', el).onclick = () => vehModal();
  bindRows(el, rows, vehModal);
};
function vehModal(v) {
  const upload = `<div class="full" style="margin-top:12px"><label>Photo (vehicle only, no people)<input type="file" id="img" accept="image/png,image/jpeg,image/webp,image/gif"></label><div id="prev" style="margin-top:8px">${v?.image ? `<img src="${esc(v.image)}" style="max-height:120px;border-radius:8px">` : ''}</div><input type="hidden" id="imgurl" value="${esc(v?.image || '')}"></div>`;
  const m = simpleModal(v ? v.name : 'New vehicle', VEH_F, v, '/vehicles');
  $('.mb', m.ov).insertAdjacentHTML('beforeend', upload);
  $('#img', m.ov).onchange = (e) => guard(async () => { const f = e.target.files[0]; if (!f) return; const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'content-type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); $('#imgurl', m.ov).value = j.url; $('#prev', m.ov).innerHTML = `<img src="${j.url}" style="max-height:120px;border-radius:8px">`; }, 'Uploaded, click Save');
  const old = $('#save', m.ov); const nb = old.cloneNode(true); old.replaceWith(nb);
  nb.onclick = () => guard(async () => { const o = readForm(VEH_F, m.ov); if (!reqCheck(VEH_F, o)) return; o.image = $('#imgurl', m.ov).value; v ? await PUT('/vehicles/' + v.id, o) : await POST('/vehicles', o); m.close(); await refresh(); }, 'Saved');
}

// ---------- drivers ----------
const DRV_F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'phone', l: 'Phone (for text link)', t: 'tel' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'vendor_id', l: 'Works for vendor', t: 'select', o: [] }, { k: 'active', l: 'Active', t: 'check' }, { k: 'notes', l: 'Notes', t: 'textarea', full: 1 }];
VIEWS.drivers = async (el) => {
  const rows = await GET('/drivers');
  el.innerHTML = `<div class="panel" style="background:var(--blue-l);border-color:#bcdcf0"><b>How drivers sign in:</b> every driver has a private link, no password. Send it by email or text; they open it once and their phone remembers them. They only see their own trips, and customer contact info unlocks ${S.settings?.driver_window_before_hrs || 24} hours before pickup. If a phone is lost, regenerate the link to cut off the old one.</div><div class="toolbar">${button('+ Driver', 'primary', 'id="new"')}${exportBtn('drivers')}</div>${table([{ h: 'Driver', f: (d) => `<span class="bold">${esc(d.name)}</span>` }, { h: 'Phone', f: (d) => esc(d.phone) }, { h: 'Email', f: (d) => esc(d.email) }, { h: 'Vendor', f: (d) => esc(d.vendor_name || '-') }, { h: 'Portal link', f: (d) => `<button class="btn sm" data-copy="${esc(location.origin + '/d/' + d.token)}">Copy</button> <button class="btn sm" data-send="${d.id}" data-via="email">Email</button> <button class="btn sm" data-send="${d.id}" data-via="sms">Text</button>` }, { h: '', f: (d) => (d.active ? '' : badge('inactive')) }], rows, { onClick: 1, empty: 'Add your drivers to give them portal links.' })}`;
  $('#new', el).onclick = () => drvModal();
  bindRows(el, rows, drvModal);
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]'); if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Link copied')).catch(() => prompt('Driver link:', c.dataset.copy)); }
    const s = e.target.closest('[data-send]'); if (s) guard(async () => { const r = await POST(`/drivers/${s.dataset.send}/send-link`, { via: s.dataset.via }); if (r.result?.ok === false) throw new Error(r.result.error || 'Could not send'); }, 'Link sent');
  });
};
function drvModal(d) {
  const F = DRV_F.map((f) => (f.k === 'vendor_id' ? { ...f, o: vndOpts() } : f));
  const m = simpleModal(d ? d.name : 'New driver', F, d, '/drivers', d ? button('Regenerate link', '', 'id="regen"') : '');
  $('#regen', m.ov)?.addEventListener('click', () => guard(async () => { if (!confirm('The old link stops working immediately. Continue?')) return; await POST(`/drivers/${d.id}/regenerate`); m.close(); await refresh(); }, 'New link generated'));
}

// ---------- follow-ups ----------
VIEWS.followups = async (el) => {
  let tab = 'due';
  const draw = async () => {
    const rows = await GET('/followups?limit=300' + (tab === 'due' ? '&due=1' : tab === 'pending' ? '&status=pending' : ''));
    const list = tab === 'done' ? rows.filter((r) => r.status !== 'pending') : rows;
    $('#list', el).innerHTML = table([{ h: 'Task', f: (f) => `<span class="bold">${esc(f.subject || f.kind.replace('_', ' '))}</span><br><span class="mut sm">${esc(f.entity_type)} ${f.entity_id || ''} · ${f.auto ? 'automatic email' : esc(f.channel)}</span>` }, { h: 'Due', f: (f) => `${fmt(f.due_at)}<br><span class="mut sm">${ago(f.due_at)}</span>` }, { h: 'Status', f: (f) => badge(f.status) + (f.result ? `<br><span class="mut sm">${esc(f.result)}</span>` : '') }, { h: '', f: (f) => (f.status === 'pending' ? `${f.auto ? '' : `<button class="btn sm" data-d="${f.id}">Done</button> `}<button class="btn sm danger" data-s="${f.id}">${f.auto ? 'Cancel' : 'Skip'}</button>` : '') }], list, { empty: tab === 'due' ? 'Nothing due right now.' : 'Nothing here.' });
  };
  el.innerHTML = `<div class="toolbar">${chips([['due', 'Due now'], ['pending', 'All upcoming'], ['done', 'History']], tab)}<span class="sp" style="flex:1"></span>${exportBtn('followups')}${button('Run automation now', '', 'id="run"')}${button('Compose email', '', 'id="mail"')}${button('+ Task', 'primary', 'id="new"')}</div><div class="panel" style="padding:12px 16px">Automatic follow-ups (quote nudges, invoice reminders, trip reminders, thank-yous, vendor reminders) send on their own and skip themselves if no longer needed. Tune them in <a href="#/settings">Settings</a>.</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; tab = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  $('#new', el).onclick = () => { const F = [{ k: 'subject', l: 'Task', req: 1, full: 1 }, { k: 'due_at', l: 'Due', t: 'datetime', def: new Date(Date.now() + 864e5).toISOString().slice(0, 16) }, { k: 'body', l: 'Details', t: 'textarea', full: 1 }]; modal({ title: 'New follow-up task', body: formHTML(F), small: true, footer: `<span class="sp"></span>${button('Add', 'primary', 'id="s"')}`, onMount(ov, close) { $('#s', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; o.due_at = new Date(o.due_at).toISOString(); await POST('/followups', o); close(); reload(); }, 'Added'); } }); };
  $('#mail', el).onclick = () => composeEmail({});
  $('#run', el).onclick = () => guard(async () => { const r = await POST('/followups/run'); draw(); toast(`${r.sent} sent`); });
  el.addEventListener('click', (e) => { const d = e.target.closest('[data-d]'); const s = e.target.closest('[data-s]'); if (d) guard(async () => { await PUT('/followups/' + d.dataset.d, { status: 'done' }); draw(); }); if (s) guard(async () => { await PUT('/followups/' + s.dataset.s, { status: 'skipped' }); draw(); }); });
  await draw();
};
function composeEmail({ to = '', subject = '', body = '', entity_type, entity_id }) {
  const tb = [['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['underline', '<u>U</u>', 'Underline'], ['insertUnorderedList', '&bull; List', 'Bullet list'], ['insertOrderedList', '1. List', 'Numbered list'], ['createLink', 'Link', 'Add link'], ['removeFormat', 'Clear', 'Clear formatting']];
  modal({ title: 'Write an email', small: true, body: `<div class="fgrid"><label class="full">To<input id="to" type="email" value="${esc(to)}"></label><label class="full">Subject<input id="sub" value="${esc(subject)}"></label></div>
    <div class="rte-bar">${tb.map(([c, h, t]) => `<button type="button" class="btn sm" data-cmd="${c}" title="${t}">${h}</button>`).join('')}</div>
    <div id="rte" class="rte" contenteditable="true" role="textbox" aria-multiline="true">${body ? esc(body).replace(/\n/g, '<br>') : ''}</div><p class="hint">Bold, lists, links and line breaks are kept. It is sent in the Get A Bus NY email design. Find it afterwards under Sent messages.</p>`,
  footer: `<span class="sp"></span>${button('Send', 'primary', 'id="s"')}`, onMount(ov, close) {
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (!b) return; e.preventDefault(); $('#rte', ov).focus(); if (b.dataset.cmd === 'createLink') { const u = prompt('Link address (https://...)'); if (u) document.execCommand('createLink', false, u); } else document.execCommand(b.dataset.cmd); });
    $('#s', ov).onclick = () => guard(async () => { const t = $('#to', ov).value.trim(), sub = $('#sub', ov).value.trim(), html = $('#rte', ov).innerHTML.trim(); if (!t || !sub || !$('#rte', ov).textContent.trim()) return toast('Recipient, subject and message are required', true); const r = await POST('/messages/email', { to: t, subject: sub, html, entity_type, entity_id }); if (!r.ok) throw new Error(r.error || 'Failed'); close(); toast(r.status === 'logged' ? 'Saved to Sent messages (no email provider connected)' : 'Sent'); });
  } });
}
// ---------- inbox / activity ----------
VIEWS.inbox = async (el) => {
  const rows = await GET('/messages');
  el.innerHTML = table([{ h: 'From', f: (m) => `<span class="bold">${esc(m.name)}</span><br><span class="mut sm">${esc(m.email || m.phone)}</span>` }, { h: 'Subject', f: (m) => `${esc(m.subject || '(no subject)')}<br><span class="mut sm">${esc((m.body || '').slice(0, 90))}</span>` }, { h: 'Received', f: (m) => ago(m.created_at) }, { h: 'Status', f: (m) => badge(m.status) }], rows, { onClick: 1, empty: 'No messages.' });
  bindRows(el, rows, (m) => modal({ title: m.subject || 'Message', body: `<p><b>${esc(m.name)}</b> · ${esc(m.email || '')} ${esc(m.phone || '')} · ${fmt(m.created_at)}</p><p style="white-space:pre-wrap">${esc(m.body)}</p>`, footer: `<span class="sp"></span>${m.email ? button('Reply', '', 'id="r"') : ''}${button(m.status === 'new' ? 'Mark read' : 'Mark unread', 'primary', 'id="m"')}`, onMount(ov, close) { $('#m', ov).onclick = () => guard(async () => { await PUT('/messages/' + m.id, { status: m.status === 'new' ? 'read' : 'new' }); close(); reload(); }); $('#r', ov)?.addEventListener('click', () => { close(); composeEmail({ to: m.email, subject: 'Re: ' + (m.subject || 'your message') }); }); } }));
};
VIEWS.activity = async (el) => {
  const [a, o] = await Promise.all([GET('/activity'), GET('/outbox')]);
  el.innerHTML = `<div class="cols"><div class="panel"><h3>Activity log</h3>${table([{ h: 'When', f: (r) => ago(r.at) }, { h: 'Who', f: (r) => esc(r.actor) }, { h: 'Action', f: (r) => esc(r.action) }, { h: 'Detail', f: (r) => esc(r.detail) }], a)}</div><div class="panel"><h3>Email outbox</h3><p class="mut sm">"logged" means no email provider is configured, so the message was recorded but not delivered.</p>${table([{ h: 'When', f: (r) => ago(r.created_at) }, { h: 'To', f: (r) => esc(r.to_addr) }, { h: 'Subject', f: (r) => esc(r.subject) }, { h: '', f: (r) => badge(r.status === 'sent' ? 'paid' : r.status === 'failed' ? 'failed' : 'draft').replace(/>[^<]*</, `>${esc(r.status)}<`) }], o)}</div></div>`;
};

// ---------- contracts ----------
VIEWS.contracts = async (el) => {
  const rows = await GET('/contracts');
  el.innerHTML = `<div class="toolbar">${exportBtn('contracts')}<span class="mut sm">Customers sign automatically when they accept a quote online. Create one for any trip from the trip screen.</span></div>${table([{ h: 'Agreement', f: (k) => `<span class="bold">${esc(k.number)}</span>` }, { h: 'Customer', f: (k) => esc(k.customer_name) }, { h: 'Trip', f: (k) => esc(k.trip_ref || '-') }, { h: 'Total', f: (k) => usd(k.total_cents), cls: 'r' }, { h: 'Status', f: (k) => badge(k.status === 'signed' ? 'accepted' : k.status).replace(/>[^<]*</, `>${esc(k.status)}<`) }, { h: 'Signed', f: (k) => (k.signed_at ? `${esc(k.signer_name)}<br><span class="mut sm">${ago(k.signed_at)}</span>` : '-') }, { h: '', f: (k) => (k.status === 'signed' ? `<a class="btn sm" href="/api/admin/contracts/${k.id}/pdf" target="_blank">PDF</a>` : `<button class="btn sm" data-send="${k.id}">${k.status === 'draft' ? 'Send' : 'Re-send'}</button> <button class="btn sm danger" data-void="${k.id}">Void</button>`) }], rows, { empty: 'No agreements yet.' })}`;
  el.addEventListener('click', (e) => { const s1 = e.target.closest('[data-send]'); const v = e.target.closest('[data-void]'); if (s1) guard(async () => { await POST(`/contracts/${s1.dataset.send}/send`); reload(); }, 'Sent'); if (v && confirm('Void this agreement?')) guard(async () => { await POST(`/contracts/${v.dataset.void}/void`); reload(); }); });
};
VIEWS.messages = async (el) => {
  let type = 'all', q = '';
  const draw = async () => {
    const rows = await GET(`/messages-sent?type=${type}&q=${encodeURIComponent(q)}`);
    $('#list', el).innerHTML = table([{ h: 'When', f: (m) => `${ago(m.at)}<br><span class="mut sm">${fmt(m.at)}</span>` }, { h: 'Type', f: (m) => (m.type === 'email' ? '<span class="badge b-b">email</span>' : `<span class="badge b-a">text${m.direction === 'in' ? ' in' : ''}</span>`) }, { h: 'To', f: (m) => esc(m.to) }, { h: 'Subject or message', f: (m) => `<span class="clip">${esc(m.title)}</span>` }, { h: 'Status', f: (m) => badge(m.status === 'sent' || m.status === 'received' ? 'paid' : m.status === 'logged' || m.status === 'queued' ? 'pending' : m.status).replace(/>[^<]*</, `>${esc(m.status)}<`) }], rows, { onClick: 1, empty: 'No messages yet.' });
    bindRows($('#list', el), rows, (m) => (m.type === 'email' ? emailView(m.id) : smsView(m.id)));
  };
  el.innerHTML = `<div class="toolbar">${chips([['all', 'Everything'], ['email', 'Emails'], ['sms', 'Texts']], type)}<input type="search" id="q" placeholder="Search recipient, subject or text...">${button('Write email', 'primary', 'id="w"')}${exportBtn('emails', 'Export emails')}${exportBtn('texts', 'Export texts')}</div><p class="mut sm">Every email and text the system sends, exactly as the person received it. Click one to see it.</p><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; type = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#w', el).onclick = () => composeEmail({});
  await draw();
};
async function emailView(id) {
  const m = await GET(`/messages-sent/email/${id}`);
  modal({ title: m.subject, body: `<dl class="kv" style="margin-bottom:12px"><div><dt>To</dt><dd>${esc(m.to_addr)}</dd></div><div><dt>From</dt><dd>${esc(m.from_addr || '')}</dd></div><div><dt>Sent</dt><dd>${fmt(m.created_at)}</dd></div><div><dt>Status</dt><dd>${esc(m.status)}${m.error ? `<br><span class="mut sm">${esc(m.error)}</span>` : ''}</dd></div><div><dt>Sent through</dt><dd>${esc(m.provider || '')}</dd></div>${m.attachments ? `<div><dt>Attachments</dt><dd>${esc(m.attachments)}</dd></div>` : ''}</dl>
    <div class="seg2"><button type="button" class="btn sm primary" data-w="640">Computer</button><button type="button" class="btn sm" data-w="375">Phone</button></div>
    <div class="mailframe"><iframe id="mf" sandbox="allow-same-origin" title="Email as received"></iframe></div>`,
  footer: `<span class="sp"></span>${button('Send this again', '', 'id="again"')}`, onMount(ov) {
    const f = $('#mf', ov);
    f.srcdoc = String(m.html).replace(/<head>/i, '<head><base target="_blank">') || '';
    const fit = () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } catch {} };
    f.onload = fit;
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; $$('[data-w]', ov).forEach((x) => x.classList.toggle('primary', x === b)); f.style.width = b.dataset.w + 'px'; setTimeout(fit, 80); });
    $('#again', ov).onclick = () => guard(async () => { await POST(`/messages-sent/email/${id}/resend`); toast('Sent again'); }, null);
  } });
}
async function smsView(id) {
  const m = await GET(`/messages-sent/sms/${id}`);
  modal({ title: m.direction === 'in' ? 'Text received' : 'Text sent', small: true, body: `<dl class="kv" style="margin-bottom:12px"><div><dt>${m.direction === 'in' ? 'From' : 'To'}</dt><dd>${esc(m.customer_name ? m.customer_name + ' ' : '')}${esc(m.to_phone)}</dd></div><div><dt>Time</dt><dd>${fmt(m.created_at)}</dd></div><div><dt>Status</dt><dd>${esc(m.status)}${m.error ? `<br><span class="mut sm">${esc(m.error)}</span>` : ''}</dd></div><div><dt>Type</dt><dd>${esc((m.kind || '').replace('_', ' '))}</dd></div></dl>
    <div class="phone"><div class="bubble ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.body)}</div><div class="bubble-t">${fmt(m.created_at)}</div></div>` });
}

VIEWS.chesky = (el) => renderChat(el, { GET, POST, PUT, DEL, esc, toast, badge, table, modal, button, ago });

// ---------- alerts: each admin chooses what they hear about, by email and/or text ----------
async function notifyModal(uid) {
  const [u, evs] = await Promise.all([GET(`/users/${uid}/notify`), GET('/notify-events')]);
  modal({ title: `Alerts for ${u.name || u.email}`, body: `<label>Mobile number for text alerts<input id="ph" type="tel" value="${esc(u.phone)}" placeholder="10 digit number"></label><p class="hint">Pick what reaches you. Texts are short and link to the admin.</p>
    <div class="tblwrap"><table class="tbl nm"><thead><tr><th>Event</th><th class="r">Email</th><th class="r">Text</th></tr></thead><tbody>${evs.map((e) => `<tr><td data-l="Event">${esc(e.label)}</td><td class="r" data-l="Email"><input type="checkbox" data-e="${e.key}" data-c="email" ${u.prefs[e.key].email ? 'checked' : ''}></td><td class="r" data-l="Text"><input type="checkbox" data-e="${e.key}" data-c="sms" ${u.prefs[e.key].sms ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>`,
  footer: `${button('Send me a test', '', 'id="tst"')}<span class="sp"></span>${button('Save', 'primary', 'id="sv"')}`, onMount(ov, close) {
    const collect = () => { const prefs = {}; $$('[data-e]', ov).forEach((c) => { (prefs[c.dataset.e] ||= {})[c.dataset.c] = c.checked; }); return { phone: $('#ph', ov).value, prefs }; };
    $('#sv', ov).onclick = () => guard(async () => { await PUT(`/users/${uid}/notify`, collect()); close(); reload(); }, 'Alerts saved');
    $('#tst', ov).onclick = () => guard(async () => { await PUT(`/users/${uid}/notify`, collect()); const r = await POST(`/users/${uid}/notify-test`); toast(r.sms && !r.sms.ok ? `Email sent. Text failed: ${r.sms.error}` : 'Test sent'); });
  } });
}

// ---------- settings ----------
VIEWS.settings = async (el) => {
  const s = await GET('/settings'); S.settings = s;
  const me = await GET('/me'); const users = await GET('/users');
  const hours = J(s.hours); const soc = J(s.socials);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const intg = me.integrations;
  const st = (ok, l, how) => `<tr><td>${l}</td><td>${ok ? badge('paid').replace('paid', 'connected') : badge('void').replace('void', 'not set')}</td><td class="mut sm">${how}</td></tr>`;
  const F = [{ sec: 'Business' }, { k: 'business_name', l: 'Business name' }, { k: 'phone', l: 'Phone' }, { k: 'email', l: 'Public email' }, { k: 'address', l: 'Address (shown if filled)', places: 1 }, { k: 'service_area', l: 'Service area', full: 1 }, { sec: 'Money defaults' }, { k: 'tax_rate', l: 'Default tax %', t: 'number', step: 0.001 }, { k: 'deposit_pct', l: 'Default deposit %', t: 'number' }, { k: 'quote_valid_days', l: 'Quote valid (days)', t: 'number' }, { k: 'invoice_due_days', l: 'Invoice due (days)', t: 'number' }, { sec: 'Texts, reviews & agreements' }, { k: 'sms_enabled', l: 'Text messages', t: 'select', o: [['1', 'On (opted-in customers only)'], ['0', 'Off']] }, { k: 'sms_quiet_start', l: 'No automatic texts from', help: 'e.g. Fri 14:00 (office time, Eastern)' }, { k: 'sms_quiet_end', l: 'Resume texts at', help: 'e.g. Sat 21:30, held texts go out then' }, { k: 'sms_own_number', l: 'Our SimpleSender number', help: '10 digits. Needed so replies and STOP are picked up.' }, { k: 'google_review_url', l: 'Google review link', full: 1, help: 'Your Google Business "write a review" link. It goes in thank-you emails and texts.' }, { k: 'require_signature', l: 'Customers must sign to accept a quote', t: 'select', o: [['1', 'Yes (recommended)'], ['0', 'No, a click is enough']] }, { k: 'trip_purposes', l: 'Trip purposes on the booking form', full: 1, help: 'comma separated' }, { sec: 'Bus routing: vehicle size, used to avoid roads closed to buses' }, { k: 'bus_height_cm', l: 'Height (cm)', t: 'number', help: 'Typical coach 370' }, { k: 'bus_width_cm', l: 'Width (cm)', t: 'number', help: 'Typical coach 260' }, { k: 'bus_length_cm', l: 'Length (cm)', t: 'number', help: 'Typical 45 ft coach 1370' }, { k: 'bus_weight_kg', l: 'Weight (kg)', t: 'number', help: 'Typical coach 18000' }, { sec: 'Email' }, { k: 'email_from', l: 'Send-from address', help: 'e.g. Get A Bus NY <quotes@getabusny.com> (must be verified in Resend)' }, { k: 'notify_email', l: 'Alerts go to', t: 'email', help: 'new leads, payments, vendor replies. Defaults to public email' }, { sec: 'Automatic follow-ups' }, { k: 'fu_enabled', l: 'Automation on', t: 'select', o: [['1', 'On'], ['0', 'Off']] }, { k: 'fu_quote_days', l: 'Quote nudges, days after sending', help: 'comma separated, blank = none' }, { k: 'fu_invoice_before_days', l: 'Invoice reminders, days before due' }, { k: 'fu_invoice_after_days', l: 'Overdue reminders, days after due' }, { k: 'fu_trip_confirm_hours', l: 'Trip reminder, hours before pickup', t: 'number' }, { k: 'fu_trip_thanks_days', l: 'Thank-you, days after trip', t: 'number' }, { k: 'fu_rfq_hours', l: 'Vendor reminder, hours after request', t: 'number' }, { sec: 'Driver portal' }, { k: 'driver_window_before_hrs', l: 'Unlock customer contact, hours before', t: 'number' }, { k: 'driver_window_after_hrs', l: 'Keep unlocked, hours after trip', t: 'number' }, { sec: 'Chesky (website chat)' }, { k: 'chesky_public', l: 'Show chat on website', t: 'select', o: [['1', 'Yes'], ['0', 'No']] }, { k: 'chesky_name', l: 'Assistant name' }, { k: 'chesky_extra', l: 'Extra instructions for Chesky', t: 'textarea', full: 1, help: 'e.g. current promotions, areas you do not serve, minimum hours' }];
  el.innerHTML = `<div class="panel"><h3>General settings</h3>${formHTML(F, s)}
  <div class="fsec" style="margin-top:18px">Hours of operation (shown on site)</div>${days.map((d) => { const h = hours.find((x) => x.day === d) || { open: '', close: '' }; return `<div style="display:grid;grid-template-columns:110px 1fr 1fr;gap:8px;margin:4px 0;align-items:center"><b>${d}</b><input data-h="${d}" data-w="open" value="${esc(h.open)}" placeholder="10:00 AM (blank = closed)"><input data-h="${d}" data-w="close" value="${esc(h.close)}" placeholder="7:00 PM"></div>`; }).join('')}
  <div class="fsec" style="margin-top:18px">Social links</div><div class="fgrid">${['twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'google'].map((k) => `<label>${k}<input data-soc="${k}" value="${esc(soc[k] || '')}" placeholder="https://"></label>`).join('')}</div>
  <p style="margin-top:16px">${button('Save settings', 'primary', 'id="save"')}</p></div>
  <div class="panel"><h3>Dispatch calendar</h3><p class="mut">Subscribe once and every trip appears (and updates) in Google Calendar, Apple Calendar or Outlook. In Google Calendar: Other calendars → From URL.</p><div id="calbox" class="mut">Loading…</div></div>
  <div class="panel"><h3>Export to Excel</h3><p class="mut">Download any table, or everything in one workbook.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn primary" href="/api/admin/export/all" download>Everything (one workbook)</a>${['customers', 'leads', 'quotes', 'quote_lines', 'trips', 'stops', 'invoices', 'invoice_lines', 'payments', 'contracts', 'vendors', 'rfqs', 'drivers', 'fleet', 'followups', 'messages', 'texts', 'traffic', 'activity'].map((k) => exportBtn(k, k.replace('_', ' '))).join('')}</div></div>
  <div class="panel"><h3>Integrations</h3><table class="tbl"><tbody>${st(intg.stripe, 'Stripe payments', 'Set STRIPE_SECRET_KEY on the server')}${st(intg.stripe_webhook, 'Stripe webhook', `Set STRIPE_WEBHOOK_SECRET; endpoint: ${location.origin}/api/stripe/webhook (event: checkout.session.completed, charge.refunded)`)}${st(intg.email, `Email sending${intg.email_provider ? ' (' + intg.email_provider + ')' : ''}`, 'Set BREVO_API_KEY (or RESEND_API_KEY). Until then emails are only logged in Activity → Outbox')}${st(intg.maps, 'Google Maps address suggestions', 'Set GOOGLE_MAPS_API_KEY (Places API New + Routes API enabled)')}${st(intg.sms, 'Text messages (SimpleSender)', 'Set SMS_API_BASE and SMS_API_KEY (SimpleSender dashboard, Developer, Docs and Keys). Add your number below so replies and STOP are picked up')}${st(intg.here, 'Bus-safe routing (HERE)', 'Set HERE_API_KEY. Without it routes use Google and are not bus aware')}${st(intg.chesky, 'Chesky AI', 'Set CHESKY_API_KEY (its own Anthropic key)')}</tbody></table></div>
  <div class="panel"><h3>Team logins</h3>${table([{ h: 'Name', f: (u) => esc(u.name) }, { h: 'Email', f: (u) => esc(u.email) }, { h: 'Phone', f: (u) => esc(u.phone || '') }, { h: '', f: (u) => `<button class="btn sm" data-notify="${u.id}">Alerts</button> ${u.id === me.user.id ? '<span class="mut sm">you</span>' : `<button class="btn sm danger" data-du="${u.id}">Remove</button>`}` }], users)}
   <div class="fgrid" style="margin-top:12px"><label>New user email<input id="ue" type="email"></label><label>Name<input id="un"></label><label>Password (10+ chars)<input id="up" type="password" autocomplete="new-password"></label><label>&nbsp;${button('Add user', '', 'id="addu"')}</label></div>
   <div class="fsec" style="margin-top:18px">Change my password</div><div class="fgrid"><label>Current<input id="pc" type="password" autocomplete="current-password"></label><label>New (10+ chars)<input id="pn" type="password" autocomplete="new-password"></label></div><p>${button('Change password', '', 'id="chpw"')}</p></div>`;
  placesFor(el);
  el.addEventListener('click', (e) => { const n = e.target.closest('[data-notify]'); if (n) notifyModal(+n.dataset.notify); });
  GET('/calendar-link').then((c) => { $('#calbox', el).innerHTML = `<p><b>All trips (staff)</b><div class="copybox"><input readonly value="${esc(c.staff)}" onclick="this.select()"></div></p>${c.drivers.map((d) => `<p><b>${esc(d.name)}</b> (that driver's trips only)<div class="copybox"><input readonly value="${esc(d.url)}" onclick="this.select()"></div></p>`).join('')}<p class="hint">Anyone with a link can see those trips, so treat it like a password. <button class="link" id="calregen">Replace the staff link</button></p>`; $('#calregen', el)?.addEventListener('click', () => { if (confirm('The old staff link stops working. Continue?')) guard(async () => { await POST('/calendar-link/regenerate'); reload(); }); }); }).catch(() => {});
  $('#save', el).onclick = () => guard(async () => {
    const o = readForm(F, el);
    o.hours = days.map((d) => ({ day: d, open: $(`[data-h=${d}][data-w=open]`, el).value.trim(), close: $(`[data-h=${d}][data-w=close]`, el).value.trim() }));
    o.socials = Object.fromEntries($$('[data-soc]', el).map((i) => [i.dataset.soc, i.value.trim()]));
    for (const k of ['tax_rate', 'deposit_pct', 'quote_valid_days', 'invoice_due_days', 'fu_trip_confirm_hours', 'fu_trip_thanks_days', 'fu_rfq_hours', 'driver_window_before_hrs', 'driver_window_after_hrs']) o[k] = o[k] ?? '';
    await PUT('/settings', o); S.settings = await GET('/settings');
  }, 'Settings saved');
  $('#addu', el).onclick = () => guard(async () => { await POST('/users', { email: $('#ue', el).value, name: $('#un', el).value, password: $('#up', el).value }); reload(); }, 'User added');
  $('#chpw', el).onclick = () => guard(async () => { await POST('/password', { current: $('#pc', el).value, next: $('#pn', el).value }); $('#pc', el).value = $('#pn', el).value = ''; }, 'Password changed');
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-du]'); if (b && confirm('Remove this user?')) guard(async () => { await DEL('/users/' + b.dataset.du); reload(); }); });
};

// ---------- Chesky (admin) ----------
const chesSid = Math.random().toString(36).slice(2);
function initChesky() {
  const add = (t, w) => { const d = document.createElement('div'); d.className = 'cm ' + w; d.textContent = t; $('#ches-m').append(d); $('#ches-m').scrollTop = 1e9; return d; };
  $('#ches-btn').hidden = false;
  $('#ches-btn').onclick = () => { $('#ches').hidden = false; $('#ches-btn').hidden = true; if (!$('#ches-m').children.length) add('Hi, ask me about leads, quotes, invoices, trips or customers. Try: "who owes us money?" or "what\'s on this week?"', 'b'); $('#ches-i').focus(); };
  $('#ches-x').onclick = () => { $('#ches').hidden = true; $('#ches-btn').hidden = false; };
  $('#ches-f').onsubmit = async (e) => { e.preventDefault(); const i = $('#ches-i'), t = i.value.trim(); if (!t) return; i.value = ''; add(t, 'u'); const w = add('…', 'b'); try { const r = await POST('/chesky', { message: t, session_id: chesSid }); w.textContent = r.reply || '(no answer)'; } catch (x) { w.textContent = x.message; } $('#ches-m').scrollTop = 1e9; };
}

// ---------- boot ----------
function showLogin() { $('#shell').hidden = true; $('#login').hidden = false; }
async function start() {
  try { const me = await GET('/me'); S.me = me.user; } catch { return showLogin(); }
  $('#login').hidden = true; $('#shell').hidden = false;
  S.settings = await GET('/settings'); S.cfg = await (await fetch('/api/public/config')).json(); await lookups();
  if (!window.__started) { window.__started = true; initChesky(); window.addEventListener('hashchange', route); $('#menu').onclick = () => $('#side').classList.toggle('open'); }
  route();
}
$('#lf').onsubmit = async (e) => { e.preventDefault(); $('#lerr').hidden = true; try { await api('POST', '/login', { email: $('#le').value, password: $('#lp').value }); $('#lp').value = ''; start(); } catch (x) { $('#lerr').textContent = x.message; $('#lerr').hidden = false; } };
$('#logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/logout', {}); showLogin(); };
start();
