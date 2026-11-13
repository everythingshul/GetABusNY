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
const lab = (m) => (/^\d{4}-\d\d$/.test(m) ? `${m.slice(5)}/${m.slice(0, 4)}` : /^\d\d-\d\d$/.test(m) ? m.replace('-', '/') : m);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
/** June 1, 2099 or June 1, 2099, 7:00 AM. Naive local values ('YYYY-MM-DDTHH:MM') are shown as written; ISO timestamps in the viewer's time zone. */
const fmt = (s) => { if (!s) return '-'; const n = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?$/.exec(s); if (n) return `${MONTHS[+n[2] - 1]} ${+n[3]}, ${n[1]}${n[4] ? ', ' + p12(+n[4], +n[5]) : ''}`; const d = new Date(s); if (isNaN(d)) return String(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${p12(d.getHours(), d.getMinutes())}`; };
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
/** Ask how a send should go. Resolves { skip_email, skip_sms }; never resolves if the box is closed. */
function askSend(what, { sms = true, verb = 'Send' } = {}) {
  return new Promise((resolve) => {
    modal({ title: `${verb} ${what}`, small: true, body: `<p class="mut sm">Tick a box to skip that message. The item is still marked as done, and you can copy the customer link to send it yourself.</p>
      <label style="flex-direction:row;display:flex;gap:8px;align-items:center;font-weight:500;margin:8px 0"><input type="checkbox" id="noem"> Do not email the customer</label>
      ${sms ? '<label style="flex-direction:row;display:flex;gap:8px;align-items:center;font-weight:500;margin:8px 0"><input type="checkbox" id="nosm"> Do not text the customer</label>' : ''}`,
      footer: `<span class="sp"></span>${button(verb, 'primary', 'id="go"')}`,
      onMount(ov, close) { $('#go', ov).onclick = () => { const o = { skip_email: $('#noem', ov).checked, skip_sms: !!$('#nosm', ov)?.checked }; close(); resolve(o); }; } });
  });
}

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
  ['', 'Other'], ['inbox', 'Inbox', 'unread_messages'], ['banner', 'Home banner'], ['sitetext', 'Website text'], ['chesky', 'Chesky'], ['messages', 'Sent messages'], ['activity', 'Activity'], ['settings', 'Settings'],
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
  ${d.insurance.length ? `<div class="panel"><h3>Operator insurance <a href="#/vendors" class="sm">Vendors</a></h3>${table([{ h: 'Operator', f: (v) => esc(v.name) }, { h: 'Carrier', f: (v) => esc(v.insurance_carrier || '') }, { h: 'Status', f: (v) => insBadge(v) }], d.insurance)}</div>` : ''}<div class="panel"><h3>Recent activity</h3>${table([{ h: 'When', f: (a) => ago(a.at) }, { h: 'Who', f: (a) => esc(a.actor) }, { h: 'What', f: (a) => esc(a.action) }, { h: 'Detail', f: (a) => esc(a.detail) }], d.activity)}</div>`;
  const tripsTbl = $('.cols .panel', el); bindRows(tripsTbl, d.trips_week, (t) => tripModal(t.id));
};

// ---------- analytics ----------
VIEWS.analytics = async (el) => {
  const [a, tr] = await Promise.all([GET('/analytics'), GET('/traffic?days=30')]);
  const bars = (rows, key, cls = '', fmtv = (x) => x) => { const max = Math.max(1, ...rows.map((r) => r[key])); return `<div class="bars">${rows.map((r) => `<div class="b ${cls}" title="${esc(lab(r.m))}: ${fmtv(r[key])}"><em>${fmtv(r[key])}</em><i style="height:${Math.max(2, (r[key] / max) * 100)}%"></i><span>${esc(lab(r.m))}</span></div>`).join('')}</div>`; };
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
  <div class="panel"><h3>Gratuity collected <span class="mut sm">${usd(a.gratuity.total)} on paid invoices</span></h3>${hb(a.gratuity.byDriver.map((r) => ({ k: r.k, c: r.c, label: usd(r.c) })), (r) => r.c, "bl")}<p class="hint">Gratuity added at payment, grouped by the driver on the trip. Pass it on to your drivers.</p></div>
  <div class="panel"><h3>Vendors by volume</h3>${table([{ h: 'Vendor', f: (r) => esc(r.k) }, { h: 'Trips', f: (r) => r.c, cls: 'r' }, { h: 'Cost', f: (r) => usd(r.cost), cls: 'r' }, { h: 'Revenue', f: (r) => usd(r.rev), cls: 'r' }, { h: 'Margin', f: (r) => usd(r.rev - r.cost), cls: 'r' }], a.topVendors)}</div></div>`;
};

// ---------- customers ----------
const insDays = (exp) => (exp ? Math.round((Date.parse(exp + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5) : null);
const insBadge = (v) => { const d = insDays(v.insurance_expires); if (d === null) return '<span class="badge">no date</span>'; if (d < 0) return `<span class="badge b-r">expired ${esc(fmt(v.insurance_expires))}</span>`; if (d <= 30) return `<span class="badge b-a">expires in ${d} day${d === 1 ? '' : 's'}</span>`; return `<span class="badge b-g">to ${esc(fmt(v.insurance_expires))}</span>`; };
const SMS_GROUP_LABELS = { quotes: 'Quote updates', payments: 'Payment receipts', reminders: 'Trip reminders', driver: 'Driver on the way or arrived', reviews: 'Review request after the trip' };
/** Zmanim strip: shows the day's times, flags Shabbos / Yom Tov, and keeps the latest issues for the save check. */
function wireZmanim(ov, ed, { depart, ret }) {
  const state = { issues: [] }; let tm;
  const row = (d) => { const t = [['Sunrise', d.sunrise], ['Latest Shema', d.sof_zman_shma], ['Chatzos', d.chatzot], ['Sunset', d.sunset], ['Nightfall', d.tzeit]].filter((x) => x[1]).map(([l, v]) => `<span><small>${l}</small> ${esc(v)}</span>`).join(''); return `<div class="zm-day"><b>${esc(d.weekday)}, ${esc(d.date_long)}</b>${d.holidays.length ? ` <span class="badge b-b">${esc(d.holidays.join(', '))}</span>` : ''}${d.candle_lighting ? ` <span class="badge b-a">Candle lighting ${esc(d.candle_lighting)}</span>` : ''}${d.havdalah ? ` <span class="badge b-a">Havdalah ${esc(d.havdalah)}</span>` : ''}<div class="zm-t">${t}</div></div>`; };
  const run = async () => {
    const box = $('#zm', ov); if (!box) return;
    const dep = depart(); if (!dep || dep.length < 10) { box.innerHTML = ''; state.issues = []; return; }
    try { const r = await POST('/schedule-check', { itinerary: ed.get(), depart_at: dep, return_at: ret() }); state.issues = r.issues; box.innerHTML = `${r.issues.map((i) => `<div class="${i.level === 'red' ? 'alert-bad' : 'alert-warn'}">${esc(i.text)}</div>`).join('')}${r.depart ? row(r.depart) : ''}${r.return ? row(r.return) : ''}`; } catch { /* zmanim are a convenience, never block */ }
  };
  const later = () => { clearTimeout(tm); tm = setTimeout(run, 450); };
  ['#f_depart_at', '#f_return_at'].forEach((q) => $(q, ov)?.addEventListener('change', later));
  ed.onChange(later); run();
  return { confirmBad: () => { const bad = state.issues.filter((i) => i.level === 'red'); return !bad.length || confirm(bad.map((i) => i.text).join('\n\n') + '\n\nKeep this schedule?'); } };
}
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
    const cmp = r.car ? `<div class="cmp"><div><small>BUS ROUTE</small><b>${hm(r.minutes)}</b><span>${r.miles} mi</span></div><div><small>SAME TRIP BY CAR</small><b>${hm(r.car.minutes)}</b><span>${r.car.miles} mi</span></div><div class="${r.car.extra_minutes > 0 ? 'bad' : ''}"><small>BUS RESTRICTIONS ADD</small><b>${r.car.extra_minutes > 0 ? '+' : ''}${r.car.extra_minutes} min</b><span>${r.car.extra_miles > 0 ? '+' : ''}${r.car.extra_miles} mi</span></div></div><p class="hint" style="margin:6px 0">A car would use roads a bus is not allowed on (parkways, low bridges). Quote and schedule from the bus time.</p>` : '';
    const legsHtml = r.legs.map((l, i) => { const cl = r.car?.legs?.[i]; return `<tr><td data-l="Leg">${i + 1} to ${i + 2}</td><td data-l="To">${esc(l.to)}</td><td class="r" data-l="Bus">${l.miles} mi, ${hm(l.minutes)}</td>${r.car ? `<td class="r" data-l="Car">${cl ? `${cl.miles} mi, ${hm(cl.minutes)}` : ''}</td>` : ''}<td class="r" data-l="Bus arrives">${r.stops?.[i + 1] ? esc(fmt(r.stops[i + 1].arrive)) + (r.stops[i + 1].late ? ' <span class="badge b-r">late</span>' : '') : ''}</td>${r.car_stops ? `<td class="r" data-l="Car would arrive">${r.car_stops[i + 1] ? esc(fmt(r.car_stops[i + 1].arrive)) : ''}</td>` : ''}</tr>`; }).join('');
    res.innerHTML = `${banner}${cmp}<p style="margin:6px 0"><b>${r.miles} mi</b>, <b>${hm(r.minutes)}</b> driving by bus, not counting waits. Use it as a guide when you price.</p><div class="tblwrap"><table class="tbl"><thead><tr><th>Leg</th><th>To</th><th class="r">Bus</th>${r.car ? '<th class="r">Car</th>' : ''}<th class="r">Bus arrives</th>${r.car_stops ? '<th class="r">Car would arrive</th>' : ''}</tr></thead><tbody>${legsHtml}</tbody></table></div>${r.stops ? '<p style="margin:8px 0 0"><button type="button" class="btn sm" id="rt_fill">Fill empty stop times with the bus arrivals</button></p>' : '<p class="hint">Set a pickup time on the first stop to get arrival times.</p>'}`;
    $('#rt_fill', res)?.addEventListener('click', () => { const cur = ed.get(); ed.set(cur.map((x, i) => ({ ...x, time: x.time || r.stops[i]?.arrive || '' }))); toast('Times filled in. Adjust any you like.'); });
  }));
  $('#rt_lines', ov)?.addEventListener('click', () => guard(async () => { const lines = await POST('/itinerary/lines', { itinerary: ed.get(), purpose: purpose() }); onLines(lines); toast('Lines added. Enter your prices.'); }));
}

function composeText({ customer_id, name, phone }) {
  modal({ title: `Text ${name}`, small: true, body: `<p class="mut sm">To ${esc(phone)}. Only works if they agreed to texts.</p><label>Message<textarea id="tm" rows="6" maxlength="500" placeholder="Type your message. Line breaks are kept."></textarea></label><div class="hint" id="tc">0 / 500 (about 160 characters per text)</div>`, footer: `<span class="sp"></span>${button('Send text', 'primary', 'id="go"')}`, onMount(ov, close) {
    $('#tm', ov).oninput = (e) => { $('#tc', ov).textContent = `${e.target.value.length} / 500 (about 160 characters per text)`; };
    $('#go', ov).onclick = () => guard(async () => { const m = $('#tm', ov).value.trim(); if (!m) return toast('Write a message', true); await POST(`/customers/${customer_id}/text`, { message: m }); close(); }, 'Text sent');
  } });
}
const CUST_F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'company', l: 'Company / organization' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'address', l: 'Address', full: 1, places: 1 }, { k: 'sms_stop', l: 'Do not text this customer (they replied STOP or asked us to stop)', t: 'check', full: 1 }, { k: 'tags', l: 'Tags', help: 'comma separated, e.g. camp, shul, repeat' }, { k: 'notes', l: 'Internal notes', t: 'textarea', full: 1 }];
async function customerModal(id, after) {
  const c = id ? await GET('/customers/' + id) : {}; c.sms_stop = !!c.sms_stop_at;
  const h = id ? await GET(`/customers/${id}/history`) : null;
  const m = modal({
    title: id ? c.name : 'New customer', body: formHTML(CUST_F, c) + (h ? `<div class="fsec" style="margin-top:20px">History</div><div class="kv"><div><dt>Trips</dt><dd>${h.trips.length}</dd></div><div><dt>Quotes</dt><dd>${h.quotes.length}</dd></div><div><dt>Invoiced</dt><dd>${usd(h.invoices.reduce((s, i) => s + i.total_cents, 0))}</dd></div><div><dt>Outstanding</dt><dd>${usd(h.invoices.filter((i) => ['sent', 'partial'].includes(i.status)).reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0))}</dd></div></div><p>${h.trips.map((t) => `<a href="#" data-trip="${t.id}">${esc(t.ref)}</a> ${fmt(t.depart_at)} ${badge(t.status)}`).join('<br>')}</p>` : ''),
    footer: `${id ? button('Delete', 'danger', 'id="del"') : ''}<span class="sp"></span>${id && c.email ? button('Email…', '', 'id="mail"') : ''}${id && c.phone && !c.sms_stop_at ? button('Text…', '', 'id="txt"') : ''}${id ? button('New quote', '', 'id="nq"') : ''}${button('Save', 'primary', 'id="save"')}`,
    onMount(ov, close) {
      placesFor(ov);
      if (id) GET(`/customers/${id}/card`).then((card) => {
        const d = document.createElement('div'); d.className = 'cardbox';
        d.innerHTML = card ? `<b>Card on file:</b> ${esc(card.brand)} ending ${esc(card.last4)}, expires ${esc(card.exp)}, saved ${esc(fmt(card.since))} <button class="btn sm danger" id="cdel" type="button">Remove</button>` : `<b>No card on file.</b> <button class="btn sm" id="clink" type="button">Email a link to save a card</button> <button class="btn sm" id="ccopy" type="button">Copy link</button><div class="hint">Saving a card needs the customer's permission. Stripe shows them the wording. Nothing is charged when it is saved.</div>`;
        $('.mb', ov).prepend(d);
        $('#cdel', d)?.addEventListener('click', () => { if (confirm('Remove this saved card?')) guard(async () => { await DEL(`/customers/${id}/card`); close(); customerModal(id); }, 'Card removed'); });
        $('#clink', d)?.addEventListener('click', () => guard(async () => { await POST(`/customers/${id}/card-link`, { email: true }); }, 'Link emailed'));
        $('#ccopy', d)?.addEventListener('click', () => guard(async () => { const r = await POST(`/customers/${id}/card-link`, {}); prompt('Send the customer this link:', r.url); }));
      }).catch(() => {});
      $('#txt', ov)?.addEventListener('click', () => composeText({ customer_id: id, name: c.name, phone: c.phone }));
      $('#save', ov).onclick = () => guard(async () => { const o = readForm(CUST_F, ov); if (!reqCheck(CUST_F, o)) return; id ? await PUT('/customers/' + id, o) : await POST('/customers', o); close(); await refresh(); after?.(); }, 'Saved');
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
    $('#list', el).innerHTML = table([{ h: 'No.', f: (r) => `<span class="bold">#${r.seq || r.id}</span><br><span class="mut sm">${esc(r.ref)}</span>` }, { h: 'Customer', f: (r) => `<span class="bold">${esc(r.name)}</span><br><span class="mut sm">${esc(r.email || r.phone)}</span>` }, { h: 'Trip', f: (r) => { const d = J(r.details); return `${esc(d.pickup || '')} → ${esc(d.dropoff || '')}<br><span class="mut sm">${fmt(d.depart_at)} · ${d.passengers || '?'} pax</span>`; } }, { h: 'Source', f: (r) => esc(r.source) }, { h: 'Received', f: (r) => ago(r.created_at) }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No leads in this view.' });
    bindRows($('#list', el), rows, (r) => leadModal(r));
  };
  el.innerHTML = `<div class="toolbar">${chips(LEAD_STATUS, st)}<input type="search" id="q" placeholder="Search…">${button('+ Add lead', 'primary', 'id="new"')}${exportBtn('leads')}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#new', el).onclick = () => manualLead();
  await draw();
};
function manualLead() {
  const F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'company', l: 'Organization' }, { k: 'purpose', l: 'Purpose', t: 'select', o: purposeOpts() }, { k: 'passengers', l: 'Passengers', t: 'number' }, { k: 'depart_at', l: 'Departure', t: 'datetime' }, { k: 'return_at', l: 'Return', t: 'datetime' }, { k: 'vehicle_id', l: 'Vehicle', t: 'select', o: vehOpts() }, { k: '_i', t: 'custom', html: '<div class="fsec">Route</div><div id="itn_box"></div>' }, { sec: 'INTERNAL ONLY. Never shown to the customer or to operators.' }, { k: 'internal_notes', l: 'Internal notes', t: 'textarea', full: 1 }];
  modal({ title: 'Add lead (phone / walk-in)', body: formHTML(F), footer: `<span class="sp"></span>${button('Save lead', 'primary', 'id="s"')}`, onMount(ov, close) {
    const ed = itineraryEditor($('#itn_box', ov), { staff: false, roundTrip: true });
    $('#s', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; if (!o.email && !o.phone) return toast('Phone or email required', true); const it = ed.get(); if (!it.length) return toast('Add at least a pickup and destination', true); await POST('/requests/manual', { ...o, itinerary: it, trip_type: it.some((x) => x.kind === 'return_pickup') ? 'round_trip' : 'one_way' }); close(); await refresh(); }, 'Lead added'); } });
}
function leadModal(r) {
  const d = J(r.details);
  const v = S.L.vehicles.find((x) => x.id === d.vehicle_id);
  modal({
    title: `${r.ref} - ${r.name}`, body: `<dl class="kv"><div><dt>Contact</dt><dd>${esc(r.name)}<br>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a><br>` : ''}${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}</dd></div><div><dt>Purpose</dt><dd>${esc(d.purpose || '-')}</dd></div><div style="grid-column:1/-1"><dt>Route</dt><dd style="font-weight:500">${itinList(legacyItin(d))}</dd></div><div><dt>Departure</dt><dd>${fmt(d.depart_at)}</dd></div><div><dt>Return</dt><dd>${fmt(d.return_at)}</dd></div><div><dt>Passengers</dt><dd>${d.passengers || '-'}</dd></div><div><dt>Vehicle</dt><dd>${esc(v?.name || d.vehicle_pref || 'No preference')}</dd></div><div><dt>Type</dt><dd>${esc(d.trip_type || '')}</dd></div><div><dt>Source</dt><dd>${esc(r.source)}${r.referred_by ? ` · via ${esc(r.referred_by)}` : ''}</dd></div></dl>
    ${d.comments ? `<p><b>Customer notes:</b><br>${esc(d.comments)}</p>` : ''}<div class="fgrid" style="margin-top:12px"><label>Status<select id="st">${['new', 'quoting', 'quoted', 'converted', 'lost'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Internal notes (INTERNAL ONLY, never shown to the customer)<textarea id="nt">${esc(r.notes || '')}</textarea></label></div>`,
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
    $('#list', el).innerHTML = table([{ h: 'No.', f: (r) => `<span class="bold">#${r.seq || r.id}</span><br><span class="mut sm">${esc(r.number)}</span>` }, { h: 'Customer', f: (r) => esc(r.customer_name) }, { h: 'Trip', f: (r) => `${esc(r.title || '')}<br><span class="mut sm">${fmt(J(r.trip).depart_at)}</span>` }, { h: 'Total', f: (r) => usd(r.total_cents), cls: 'r' }, { h: 'Sent', f: (r) => (r.sent_at ? ago(r.sent_at) : '-') }, { h: 'Viewed', f: (r) => (r.viewed_at ? ago(r.viewed_at) : '-') }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No quotes yet. Create one from a lead.' });
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
const routeBlock = `<div class="fsec">Route, every start, pickup, stop and drop-off, in order</div><div id="itn_box"></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn sm" id="rt_est">Estimate drive time</button><button type="button" class="btn sm" id="rt_lines">Add pricing lines from route</button><span class="hint" id="rt_out">Pricing is always entered by you. These only create empty lines to fill in.</span></div><div id="rt_res" style="margin-top:10px"></div><div id="zm" style="margin-top:12px"></div>`;
async function quoteModal(id, preset = {}) {
  const q = id ? await GET('/quotes/' + id) : { items: '[]', tax_rate: Number(S.settings?.tax_rate) || 0, deposit_pct: Number(S.settings?.deposit_pct) || 50, status: 'draft', trip: '{}', valid_until: new Date(Date.now() + (Number(S.settings?.quote_valid_days) || 7) * 864e5).toISOString().slice(0, 10), ...preset };
  const trip = J(q.trip); const items = J(q.items); const tf = tripScalars();
  const F = [{ k: 'customer_id', l: 'Customer', t: 'select', o: custOpts(), req: 1 }, { k: 'title', l: 'Title', help: 'Shown to the customer, e.g. "Camp Sample visiting day"' }, { sec: 'Trip' }, ...tf, { k: '_r', t: 'custom', html: routeBlock }, { k: 'tnotes', l: 'Trip notes (shared with driver & vendors)', t: 'textarea', full: 1, def: trip.notes }, { sec: 'Pricing (you enter every price)' }];
  const resend = ['sent', 'declined', 'expired'].includes(q.status);
  const F2 = [...(resend ? [{ k: 'revision_note', l: 'Reason for this change (optional, goes in the history)', full: 1 }] : []), { k: 'tax_rate', l: 'Tax %', t: 'number', step: 0.001 }, { k: 'deposit_pct', l: 'Deposit % due to book', t: 'number', step: 1 }, { k: 'valid_until', l: 'Valid until', t: 'date' }, { k: 'notes', l: 'Note to customer (shown on quote)', t: 'textarea', full: 1 }];
  const locked = id && ['accepted'].includes(q.status);
  modal({
    title: id ? `Quote #${q.seq || q.id} (${q.number})` : 'New quote',
    body: `<div style="margin-bottom:10px">${id ? badge(q.status) + (q.viewed_at ? ` <span class="mut sm">viewed ${ago(q.viewed_at)}</span>` : '') : ''} <button class="link sm" id="newcust" type="button">+ new customer</button></div>${formHTML(F, { ...q, ...trip })}${itemsEditor(items, q.tax_rate)}<div style="margin-top:14px">${formHTML(F2, q)}</div>${id ? '<div class="fsec" style="margin-top:18px">Revision history</div><div id="revhist" class="mut">Loading...</div>' : ''}`,
    footer: `${id && q.status === 'draft' ? button('Delete', 'danger', 'id="del"') : ''}${id ? button('Duplicate', '', 'id="dup"') : ''}${id ? button('Copy customer link', '', 'id="lnk"') : ''}<span class="sp"></span>${id && !locked ? button('Mark accepted', '', 'id="acc"') : ''}${locked ? '<span class="mut sm">Accepted and signed, so this quote is locked.</span>' : button('Save', '', 'id="save"') + button(q.status === 'sent' ? 'Re-send' : 'Send to customer', 'primary', 'id="send"')}`,
    onMount(ov, close) {
      const ed = itineraryEditor($('#itn_box', ov), { staff: true, value: legacyItin(trip) });
      const zm = wireZmanim(ov, ed, { depart: () => $('#f_depart_at', ov).value, ret: () => $('#f_return_at', ov).value });
      if (id) GET(`/quotes/${id}/revisions`).then((rv) => { $('#revhist', ov).innerHTML = rv.length ? rv.map((r) => `<div class="rev"><b>Revision ${r.revision}</b> <span class="mut sm">${esc(fmt(r.changed_at))} by ${esc(r.changed_by)}</span>${r.reason ? `<div>${esc(r.reason)}</div>` : ''}<ul>${r.changes.map((c) => `<li>${esc(c.label)}${c.from || c.to ? `: ${c.from ? esc(c.from) : ''}${c.from && c.to ? ' to ' : ''}${c.to ? esc(c.to) : ''}` : ''}</li>`).join('')}</ul></div>`).join('') : 'No changes since it was first sent.'; }).catch(() => {});
      const calc = wireItems(ov, () => $('#f_tax_rate', ov).value);
      wireRouteTools(ov, ed, { vehicle: () => $('#f_vehicle_id', ov).value, depart: () => $('#f_depart_at', ov).value, purpose: () => $('#f_purpose', ov).value, onLines: (lines) => { const cur = readItems(ov); const have = new Set(cur.map((x) => x.desc)); const add = lines.filter((l) => !have.has(l.desc)); $('#items tbody', ov).insertAdjacentHTML('beforeend', add.map(itemRowHTML).join('')); calc(); } });
      $('#f_tax_rate', ov).addEventListener('input', () => $('#items', ov).dispatchEvent(new Event('input')));
      $('#newcust', ov).onclick = () => customerModal(null, async () => { await lookups(); });
      const collect = () => {
        const o = readForm([...F, ...F2], ov); if (!o.customer_id) { toast('Select a customer', true); return null; }
        if (!zm.confirmBad()) return null;
        const t = { notes: o.tnotes, purpose: o.purpose, passengers: o.passengers, depart_at: o.depart_at, return_at: o.return_at, vehicle_id: Number(o.vehicle_id) || null, itinerary: ed.get() };
        return { customer_id: Number(o.customer_id), title: o.title, tax_rate: o.tax_rate, deposit_pct: o.deposit_pct, valid_until: o.valid_until, notes: o.notes, items: readItems(ov), trip: t, revision_note: o.revision_note };
      };
      const save = async () => { const body = collect(); if (!body) return null; if (id) { await PUT('/quotes/' + id, body); return id; } const r = await POST('/quotes', { ...body, request_id: preset.request_id }); return r.id; };
      $('#save', ov)?.addEventListener('click', () => guard(async () => { if (await save()) { close(); reload(); } }, 'Saved'));
      $('#send', ov)?.addEventListener('click', () => guard(async () => { const o = await askSend('this quote'); const qid = await save(); if (!qid) return; await POST(`/quotes/${qid}/send`, o); close(); reload(); }, 'Quote marked as sent'));
      const _unused = () => guard(async () => { const qid = await save(); if (!qid) return; await POST(`/quotes/${qid}/send`); close(); reload(); }, 'Quote sent to customer');
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
    $('#list', el).innerHTML = table([{ h: 'When', f: (r) => `<span class="bold">${fmt(r.depart_at)}</span>` }, { h: 'Trip', f: (r) => `<span class="bold">#${r.seq || r.id}</span> <span class="mut sm">${esc(r.ref)}</span><br><span class="mut sm">${esc(r.customer_name)}</span>` }, { h: 'Route', f: (r) => { const n = (J(r.itinerary).length || 2); return `${esc(r.purpose || '')}${r.purpose ? '<br>' : ''}<span class="mut sm">${esc(r.pickup || '')} → ${esc(r.dropoff || '')}${n > 2 ? ` · ${n} stops` : ''}</span>`; } }, { h: 'Vehicle', f: (r) => (r.vehicle_name ? esc(r.vehicle_name) : '<span class="badge b-a">unset</span>') }, { h: 'Driver', f: (r) => (r.driver_name ? esc(r.driver_name) + (r.driver_status ? `<br><span class="mut sm">${esc(r.driver_status.replace('_', ' '))}</span>` : '') : '<span class="badge b-a">unassigned</span>') }, { h: 'Vendor', f: (r) => esc(r.vendor_name || '-') }, { h: 'Price', f: (r) => usd(r.price_cents), cls: 'r' }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No trips.' });
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
      const zm = wireZmanim(ov, ed, { depart: () => $('#f_depart_at', ov).value, ret: () => $('#f_return_at', ov).value });
      wireRouteTools(ov, ed, { vehicle: () => $('#f_vehicle_id', ov).value, depart: () => $('#f_depart_at', ov).value, purpose: () => $('#f_purpose', ov).value, onLines: () => toast('Open a quote or invoice to add the lines') });
      $('#rt_lines', ov).style.display = 'none';
      $('#save', ov).onclick = () => guard(async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return; o.itinerary = ed.get();
        if (!zm.confirmBad()) return;
        if (o.vendor_id) { const ic = await GET(`/vendors/${o.vendor_id}/insurance-check${o.depart_at ? '?on=' + o.depart_at.slice(0, 10) : ''}`); if (ic.today.status === 'expired' && !confirm(`${ic.name}'s insurance expired on ${fmt(ic.expires)}. Assign them anyway?`)) return; if (ic.today.status !== 'expired' && ic.covers_trip === false && !confirm(`${ic.name}'s insurance expires on ${fmt(ic.expires)}, before this trip. Assign them anyway?`)) return; }
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
    $('#list', el).innerHTML = table([{ h: 'No.', f: (r) => `<span class="bold">#${r.seq || r.id}</span><br><span class="mut sm">${esc(r.number)}</span>` }, { h: 'Customer', f: (r) => esc(r.customer_name) }, { h: 'Title', f: (r) => esc(r.title) }, { h: 'Total', f: (r) => usd(r.total_cents), cls: 'r' }, { h: 'Paid', f: (r) => usd(r.amount_paid_cents), cls: 'r' }, { h: 'Balance', f: (r) => `<b>${usd(r.total_cents - r.amount_paid_cents)}</b>`, cls: 'r' }, { h: 'Due', f: (r) => `${fmt(r.due_date)}${['sent', 'partial'].includes(r.status) && r.due_date < today ? ' <span class="badge b-r">overdue</span>' : ''}` }, { h: 'Status', f: (r) => badge(r.status) }], rows, { onClick: 1, empty: 'No invoices.' });
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
  const F = [{ k: 'customer_id', l: 'Customer', t: 'select', o: custOpts(), req: 1 }, { k: 'title', l: 'Title / description' }, { k: 'tax_rate', l: 'Tax %', t: 'number', step: 0.001 }, { k: 'deposit_cents', l: 'Deposit due now', t: 'money', help: 'Customers can pay this amount or the full balance' }, { k: 'gratuity_cents', l: 'Gratuity (not taxed)', t: 'money', help: 'Added by you only. Customers cannot add gratuity themselves.' }, { k: 'due_date', l: 'Due date', t: 'date' }, { k: 'status', l: 'Status', t: 'select', o: [['draft', 'draft'], ['sent', 'sent (use Send)'], ['void', 'void']] }, { k: 'notes', l: 'Note shown on invoice', t: 'textarea', full: 1 }];
  const bal = (i.total_cents || 0) - (i.amount_paid_cents || 0);
  modal({
    title: id ? `Invoice #${i.seq || i.id} (${i.number})` : 'New invoice',
    body: `${id ? `<p>${badge(i.status)} <b>${usd(i.total_cents)}</b> total · <b>${usd(i.amount_paid_cents)}</b> paid · balance <b>${usd(bal)}</b></p>` : ''}${formHTML(F, i)}<div style="margin-top:12px">${itemsEditor(J(i.items).length ? J(i.items) : [], i.tax_rate)}</div>
    ${id ? `<div class="fsec" style="margin-top:18px">Payments</div>${pays.length ? table([{ h: 'Date', f: (p) => fmt(p.created_at) }, { h: 'Method', f: (p) => esc(p.method) }, { h: 'Ref', f: (p) => esc(p.reference || '') }, { h: 'Amount', f: (p) => usd(p.amount_cents), cls: 'r' }, { h: 'Status', f: (p) => (p.status === 'authorized' ? '<span class="badge b-a">hold</span>' : p.status === 'released' ? '<span class="badge">released</span>' : p.method === 'refund' ? '<span class="badge b-r">refund</span>' : '<span class="badge b-g">paid</span>') }, { h: '', f: (p) => (p.status === 'authorized' ? `<button class="btn sm primary" data-capture="${p.id}" data-amt="${p.amount_cents}">Capture</button> <button class="btn sm" data-release="${p.id}">Release hold</button>` : p.status === 'succeeded' && p.amount_cents > 0 && p.method !== 'refund' ? `<button class="btn sm danger" data-refund="${p.id}" data-amt="${p.amount_cents}">Refund…</button>` : '') }], pays) : '<p class="mut">No payments yet.</p>'}
    <form id="payf" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:10px"><label>Record payment ($)<input id="pa" type="number" step="0.01" min="0" value="${bal > 0 ? c2d(bal) : ''}" style="width:130px"></label><label>Method<select id="pm"><option>cash</option><option>check</option><option>zelle</option><option>venmo</option><option>wire</option><option>card</option><option>other</option></select></label><label>Reference<input id="pr" style="width:150px"></label><button class="btn sm primary">Record</button></form>
    <form id="authf" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><label>Hold on customer's card ($)<input id="aa" type="number" step="0.01" min="1" value="${bal > 0 ? c2d(bal) : ''}" style="width:130px"></label><label style="flex-direction:row;display:flex;gap:6px;align-items:center;font-weight:500"><input type="checkbox" id="aemail" checked> email the link</label><button class="btn sm">Request card hold</button><span class="hint">Authorizes without charging. Capture all or part later, or release. Holds usually expire in about 7 days.</span></form>` : ''}`,
    footer: `${id && i.status === 'draft' ? button('Delete', 'danger', 'id="del"') : ''}<span class="sp"></span>${id ? button('Copy pay link', '', 'id="lnk"') : ''}${button('Save', '', 'id="save"')}${button(id && i.status !== 'draft' ? 'Re-send' : 'Send to customer', 'primary', 'id="send"')}`,
    onMount(ov, close) {
      wireItems(ov, () => $('#f_tax_rate', ov).value);
      $('#f_tax_rate', ov).addEventListener('input', () => $('#items', ov).dispatchEvent(new Event('input')));
      if (id && i.customer_id && bal > 0) GET(`/customers/${i.customer_id}/card`).then((card) => { if (!card) return; const f = document.createElement('form'); f.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)'; f.innerHTML = `<label>Charge card on file, ${esc(card.brand)} ${esc(card.last4)} ($)<input id="cc" type="number" step="0.01" min="1" value="${c2d(bal)}" style="width:130px"></label><button class="btn sm primary">Charge now</button><span class="hint">Uses the card the customer saved with their permission.</span>`; $('.mb', ov).append(f); f.onsubmit = (e) => { e.preventDefault(); const amt = d2c($('#cc', ov).value); if (!confirm(`Charge ${card.brand} ending ${card.last4} ${usd(amt)} now?`)) return; guard(async () => { await POST(`/invoices/${id}/charge-saved`, { amount_cents: amt }); close(); reload(); }, 'Charged'); }; }).catch(() => {});
      const save = async () => { const o = readForm(F, ov); if (!reqCheck(F, o)) return null; o.items = readItems(ov); if (!o.items.length) { toast('Add at least one line item', true); return null; } if (id) { await PUT('/invoices/' + id, o); return id; } return (await POST('/invoices', o)).id; };
      $('#save', ov).onclick = () => guard(async () => { if (await save()) { close(); reload(); } }, 'Saved');
      $('#send', ov).onclick = () => guard(async () => { const o = await askSend('this invoice', { sms: false }); const x = await save(); if (!x) return; await POST(`/invoices/${x}/send`, { skip_email: o.skip_email }); close(); reload(); }, 'Invoice marked as sent');
      if (id) {
        $('#del', ov)?.addEventListener('click', () => guard(async () => { if (!confirm('Delete draft invoice?')) return; await DEL('/invoices/' + id); close(); reload(); }));
        $('#lnk', ov).onclick = () => guard(async () => { const r = await GET(`/invoices/${id}/link`); await navigator.clipboard?.writeText(r.url).catch(() => {}); prompt('Customer payment link:', r.url); });
        $('#payf', ov).onsubmit = (e) => { e.preventDefault(); guard(async () => { const o = await askSend('this payment', { verb: 'Record' }); await POST(`/invoices/${id}/payments`, { amount_cents: d2c($('#pa', ov).value), method: $('#pm', ov).value, reference: $('#pr', ov).value, ...o }); close(); reload(); }, 'Payment recorded'); };
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
const VEND_F = [{ k: 'name', l: 'Company', req: 1 }, { k: 'contact_name', l: 'Contact person' }, { k: 'email', l: 'Email (for quote requests)', t: 'email' }, { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'vehicle_types', l: 'Vehicles they run', help: 'e.g. 56 coach, 33 party bus, sprinters' }, { k: 'service_area', l: 'Service area' }, { k: 'rating', l: 'Rating (1-5)', t: 'number' }, { k: 'active', l: 'Active', t: 'check' }, { sec: 'Insurance and authority' }, { k: 'insurance_carrier', l: 'Insurance carrier' }, { k: 'insurance_policy', l: 'Policy number' }, { k: 'insurance_expires', l: 'Insurance expires', t: 'date', help: 'You get alerts at 30, 14, 7 and 3 days and when it lapses' }, { k: 'dot_number', l: 'USDOT number' }, { k: 'mc_number', l: 'MC number' }, { k: 'notes', l: 'Notes (rates, reliability)', t: 'textarea', full: 1 }];
VIEWS.vendors = async (el) => {
  const rows = await GET('/vendors');
  el.innerHTML = `<div class="toolbar">${button('+ Vendor', 'primary', 'id="new"')}${exportBtn('vendors')}${exportBtn('rfqs', 'Export vendor quotes')}</div>${table([{ h: 'Vendor', f: (v) => `<span class="bold">${esc(v.name)}</span><br><span class="mut sm">${esc(v.contact_name || '')}</span>` }, { h: 'Email', f: (v) => esc(v.email) }, { h: 'Phone', f: (v) => esc(v.phone) }, { h: 'Vehicles', f: (v) => esc(v.vehicle_types) }, { h: 'Area', f: (v) => esc(v.service_area) }, { h: 'Insurance', f: (v) => insBadge(v) }, { h: 'Rating', f: (v) => '★'.repeat(v.rating || 0) }, { h: '', f: (v) => (v.active ? '' : badge('inactive')) }], rows, { onClick: 1, empty: 'Add the bus companies you work with to send them quote requests.' })}`;
  $('#new', el).onclick = () => vendorModal();
  bindRows(el, rows, vendorModal);
};
function vendorModal(v) {
  const m = simpleModal(v ? v.name : 'New vendor', VEND_F, v, '/vendors');
  if (!v) return m;
  $('.mb', m.ov).insertAdjacentHTML('beforeend', `<div class="full" style="margin-top:12px"><label>Certificate of insurance (PDF, PNG or JPG, private)<input type="file" id="coi" accept="application/pdf,image/png,image/jpeg"></label><div class="hint" id="coist">${v.coi_file ? `On file. <a href="/api/admin/vendors/${v.id}/coi" target="_blank">View certificate</a>` : 'None uploaded.'}</div></div>`);
  $('.mb', m.ov).insertAdjacentHTML('beforeend', `<div class="fsec" style="margin-top:18px">Operator checks (done by you, never by the operator)</div><div id="safer" class="mut">Loading...</div>`);
  const drawSafer = async () => {
    const d = await GET(`/vendors/${v.id}/safer`); const st = d.status;
    $('#safer', m.ov).innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><a class="btn sm" href="${esc(d.links.snapshot)}" target="_blank" rel="noopener">Open SAFER snapshot</a><a class="btn sm" href="${esc(d.links.insurance)}" target="_blank" rel="noopener">Open insurance history (L&amp;I)</a>${d.configured ? '<button type="button" class="btn sm primary" id="fm">Check FMCSA now</button>' : ''}</div>
      ${st ? `<div class="${st.problems.length ? 'alert-bad' : 'alert-ok'}"><b>${esc(st.name)}</b>: ${st.allowed ? 'allowed to operate' : 'NOT allowed to operate'}, safety rating ${esc(st.safety_rating || 'none')}, liability insurance on file ${usd(st.bipd_on_file * 100)} (required ${usd(st.bipd_required * 100)}). <span class="mut sm">Checked ${esc(fmt(d.checked_at))}</span>${st.problems.map((x) => `<div>${esc(x)}</div>`).join('')}</div>` : (d.configured ? '' : '<div class="hint">FMCSA lookups are not set up. Use the two links above and type what you see into the fields. To turn lookups on, add FMCSA_WEBKEY on the server.</div>')}
      <div class="hint">SAFER and FMCSA show whether insurance is on file and for how much. They do not show the policy expiry date, so type that from the certificate.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:8px"><label style="flex:1;min-width:220px">Insurance verification note<input id="vn" value="${esc(d.verify_note || '')}" placeholder="e.g. checked certificate, called Acme Mutual"></label><button type="button" class="btn sm" id="vv">Mark insurance verified today</button></div>
      <div class="hint">${d.verified_at ? `Last verified ${esc(fmt(d.verified_at))} by ${esc(d.verified_by || '')}.` : 'Not verified yet.'}</div>`;
    $('#fm', m.ov)?.addEventListener('click', () => guard(async () => { await POST(`/vendors/${v.id}/fmcsa-check`, {}); await drawSafer(); }, 'FMCSA checked'));
    $('#vv', m.ov).addEventListener('click', () => guard(async () => { await POST(`/vendors/${v.id}/insurance-verified`, { note: $('#vn', m.ov).value }); await drawSafer(); }, 'Marked verified'));
  };
  drawSafer().catch(() => {});
  $('#coi', m.ov).onchange = (e) => guard(async () => { const f = e.target.files[0]; if (!f) return; const r = await fetch(`/api/admin/vendors/${v.id}/coi`, { method: 'POST', headers: { 'content-type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); $('#coist', m.ov).innerHTML = `Uploaded. <a href="/api/admin/vendors/${v.id}/coi" target="_blank">View certificate</a>`; }, 'Certificate saved');
  return m;
}
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
    title: 'Request vendor prices', body: `<p class="mut">${esc(label || '')}</p><p>Operators get the trip details by email (never the customer contact info). They can reply to the email or use a link to send only a price and notes. You can also record a reply here.</p>${vs.length ? `<div class="chips" style="display:grid;gap:6px;margin-bottom:12px">${vs.map((v) => `<label style="display:flex;gap:8px;align-items:center;flex-direction:row;font-weight:500"><input type="checkbox" value="${v.id}"> <span><b>${esc(v.name)}</b> <span class="mut sm">${esc(v.vehicle_types || '')}</span> ${insDays(v.insurance_expires) !== null && insDays(v.insurance_expires) <= 30 ? insBadge(v) : ''}</span></label>`).join('')}</div>` : '<div class="empty">Add vendors with email addresses first (Vendors page).</div>'}<label>Message to vendors (optional)<textarea id="msg" placeholder="Budget, special requirements, deadline for reply…"></textarea></label>`,
    footer: `<span class="sp"></span>${button('Send requests', 'primary', 'id="go"')}`, small: true,
    onMount(ov, close) { $('#go', ov).onclick = () => guard(async () => { const ids = $$('input[type=checkbox]:checked', ov).map((x) => +x.value); if (!ids.length) return toast('Select at least one vendor', true); const lapsed = S.L.vendors.filter((x) => ids.includes(x.id) && insDays(x.insurance_expires) !== null && insDays(x.insurance_expires) < 0); if (lapsed.length && !confirm(`${lapsed.map((x) => x.name).join(', ')} ${lapsed.length > 1 ? 'have' : 'has'} expired insurance. Send the request anyway?`)) return; const r = await POST('/rfqs', { request_id, trip_id, vendor_ids: ids, message: $('#msg', ov).value }); const bad = r.sent.filter((s) => !s.email.ok).length; close(); toast(bad ? `${r.sent.length - bad} sent, ${bad} failed` : `Sent to ${r.sent.length} vendor(s)`, !!bad); reload(); }); },
  });
}
VIEWS.rfqs = async (el) => {
  let st = '';
  const draw = async () => {
    const rows = await GET('/rfqs' + (st ? '?status=' + st : ''));
    $('#list', el).innerHTML = table([{ h: 'No.', f: (r) => `<span class="bold">#${r.seq || r.id}</span><br><span class="mut sm">${esc(r.ref)}</span>` }, { h: 'For', f: (r) => esc(r.request_ref || r.trip_ref || '') }, { h: 'Vendor', f: (r) => `<span class="bold">${esc(r.vendor_name)}</span><br><span class="mut sm">${esc(r.vendor_phone || '')}</span>` }, { h: 'Trip', f: (r) => { const s = J(r.snapshot); return `${esc(s.pickup || '')} → ${esc(s.dropoff || '')}<br><span class="mut sm">${fmt(s.depart_at)} · ${s.passengers || '?'} pax</span>`; } }, { h: 'Price', f: (r) => (r.price_cents ? `<b>${usd(r.price_cents)}</b><br><span class="mut sm">${esc(r.offered_vehicle || '')}</span>` : '-'), cls: 'r' }, { h: 'Notes', f: (r) => esc(r.response_notes || '') }, { h: 'Sent', f: (r) => ago(r.sent_at) }, { h: 'Status', f: (r) => badge(r.status) }, { h: '', f: (r) => `${['sent', 'responded', 'declined'].includes(r.status) ? `<button class="btn sm" data-reply="${r.id}" data-price="${r.price_cents || ''}" data-veh="${esc(r.offered_vehicle || '')}" data-note="${esc(r.response_notes || '')}">${r.status === 'sent' ? 'Record reply' : 'Edit reply'}</button> ` : ''}${['responded', 'sent'].includes(r.status) && r.price_cents ? `<button class="btn sm primary" data-a="${r.id}">Award</button>` : ''}` }], rows, { empty: 'No vendor quote requests yet. Send them from a lead or trip.' });
  };
  el.innerHTML = `<div class="toolbar">${chips([['', 'All'], ['sent', 'Waiting'], ['responded', 'Replied'], ['accepted', 'Awarded'], ['declined', 'Declined']], st)}</div><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; st = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  el.addEventListener('click', (e) => {
    const rb = e.target.closest('[data-reply]');
    if (rb) { const id = rb.dataset.reply; const F = [{ k: 'price', l: 'Their price ($)', t: 'number', step: 0.01 }, { k: 'vehicle', l: 'Vehicle they would send' }, { k: 'notes', l: 'Notes (what is included, how they answered)', t: 'textarea', full: 1 }, { k: 'declined', l: 'They cannot do this trip', t: 'check', full: 1 }];
      modal({ title: 'Record the operator\'s reply', small: true, body: `<p class="mut sm">Operators answer by email or phone. Enter what they told you.</p>${formHTML(F, { price: rb.dataset.price ? c2d(rb.dataset.price) : '', vehicle: rb.dataset.veh, notes: rb.dataset.note })}`, footer: `<span class="sp"></span>${button('Save reply', 'primary', 'id="go"')}`, onMount(ov, close) { $('#go', ov).onclick = () => guard(async () => { const o = readForm(F, ov); await POST(`/rfqs/${id}/reply`, { price: o.price, vehicle: o.vehicle, notes: o.notes, declined: !!o.declined }); close(); draw(); }, 'Saved'); } });
      return; }
    const b = e.target.closest('[data-a]'); if (b && confirm('Award this trip to this vendor at their price? Other requests for the same trip will be closed.')) guard(async () => { await POST(`/rfqs/${b.dataset.a}/accept`); draw(); }, 'Awarded'); });
  await draw();
};

// ---------- website text ----------
VIEWS.sitetext = async (el) => {
  const d = await GET('/site-text'); const items = d.items, labels = d.labels; const edits = {}; let group = 'home', q = '';
  const cur = (it) => (it.key in edits ? edits[it.key] : (it.value || it.def));
  const draw = () => {
    const shown = items.filter((it) => (q ? `${it.def} ${it.value} ${it.label} ${it.key}`.toLowerCase().includes(q) : it.group === group)).slice(0, 150);
    const changedCount = Object.keys(edits).length;
    $('#stlist', el).innerHTML = shown.length ? shown.map((it) => { const v = cur(it); const mod = v !== it.def; return `<div class="panel" style="padding:12px;margin:0 0 10px"><div class="mut sm" style="margin-bottom:6px">${esc(it.label || it.def.slice(0, 70))}${mod ? ' <span class="badge" style="background:#e8f3d0;color:#3b5d0a">changed</span>' : ''}</div><textarea data-k="${esc(it.key)}" rows="${Math.min(8, Math.max(1, Math.ceil(v.length / 80)))}" style="width:100%">${esc(v)}</textarea>${mod ? `<button type="button" class="btn sm" data-reset="${esc(it.key)}" style="margin-top:6px">Put back the original</button>` : ''}</div>`; }).join('') + (shown.length === 150 ? '<p class="mut">Showing the first 150. Narrow it with the search box.</p>' : '') : '<div class="empty">Nothing matches.</div>';
    $('#stcount', el).textContent = changedCount ? `${changedCount} unsaved` : '';
  };
  el.innerHTML = `<div class="panel"><h3>Website text</h3><p class="mut">Change any wording on the public site, headings included. The box shows what is on the site now. You can use <b>bold</b>, <em>italics</em>, line breaks and links in the form <code>&lt;a href="/book"&gt;text&lt;/a&gt;</code>. Vehicle names, photos and prices are edited under Fleet.</p>
  <div class="toolbar"><select id="stg">${Object.entries(labels).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select><input id="stq" type="search" placeholder="Search all text..." style="flex:1;min-width:180px"><span class="mut" id="stcount"></span>${button('Save changes', 'primary', 'id="stsave"')}</div></div><div id="stlist"></div>`;
  $('#stg', el).onchange = (e) => { group = e.target.value; q = ''; $('#stq', el).value = ''; draw(); };
  $('#stq', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  el.addEventListener('input', (e) => { const k = e.target.dataset?.k; if (!k) return; const it = items.find((x) => x.key === k); if (e.target.value === (it.value || it.def)) delete edits[k]; else edits[k] = e.target.value; $('#stcount', el).textContent = Object.keys(edits).length ? `${Object.keys(edits).length} unsaved` : ''; });
  el.addEventListener('change', (e) => { if (e.target.dataset?.k) draw(); });
  el.addEventListener('click', (e) => { const r = e.target.closest('[data-reset]'); if (!r) return; const it = items.find((x) => x.key === r.dataset.reset); edits[it.key] = it.def; draw(); });
  $('#stsave', el).onclick = () => guard(async () => {
    const out = {}; for (const [k, v] of Object.entries(edits)) { const it = items.find((x) => x.key === k); out[k] = v === it.def ? '' : v; }
    await PUT('/site-text', { texts: out });
    for (const [k, v] of Object.entries(out)) { const it = items.find((x) => x.key === k); it.value = v; }
    for (const k of Object.keys(edits)) delete edits[k]; draw();
  }, 'Saved. The site shows it now.');
  draw();
};

// ---------- home banner ----------
/** Shrink a photo in the browser before upload so the home page stays fast. */
async function shrink(file, max = 2200) {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', 0.86));
}
VIEWS.banner = async (el) => {
  const d = await GET('/banner');
  el.innerHTML = `<div class="panel"><h3>Home page banner slide show</h3><p class="mut">The pictures play one after another behind the headline on the home page. Visitors cannot skip or pause them, and the pictures are blocked from right-click saving and direct links (a screenshot cannot be prevented). Wide pictures, at least 1600 pixels across, look best. Do not use photos of women.</p>
    <div class="toolbar"><label class="btn primary" style="cursor:pointer">+ Add pictures<input id="up" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label><label style="flex-direction:row;display:flex;gap:8px;align-items:center;font-weight:500">Seconds per picture <input id="secs" type="number" min="3" max="30" value="${d.seconds}" style="width:70px"></label><button class="btn" id="svsecs">Save</button><a class="btn" href="/" target="_blank">See the home page</a></div>
    <div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">${d.images.length ? d.images.map((x, i) => `<div class="panel" style="padding:8px;margin:0;${x.active ? '' : 'opacity:.55'}"><img src="/api/admin/banner/${x.id}/preview" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#eee"><div class="sm" style="margin:6px 0">${i + 1}. ${esc(x.name)}</div><div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn sm" data-mv="${x.id}" data-d="-1" ${i === 0 ? 'disabled' : ''}>Up</button><button class="btn sm" data-mv="${x.id}" data-d="1" ${i === d.images.length - 1 ? 'disabled' : ''}>Down</button><button class="btn sm" data-tg="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'Hide' : 'Show'}</button><button class="btn sm danger" data-rm="${x.id}">Delete</button></div></div>`).join('') : '<div class="empty" style="grid-column:1/-1">No pictures yet. The home page shows the plain banner until you add some.</div>'}</div></div>`;
  $('#up', el).onchange = (e) => guard(async () => { for (const f of e.target.files) { const blob = f.type === 'image/png' || f.type === 'image/webp' || f.size > 1500000 ? await shrink(f) : f; const r = await fetch('/api/admin/banner', { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg', 'x-file-name': f.name }, body: blob }); const j = await r.json(); if (!r.ok) throw new Error(j.error); } reload(); }, 'Added');
  $('#svsecs', el).onclick = () => guard(async () => { await PUT('/banner/settings', { seconds: $('#secs', el).value }); }, 'Saved');
  el.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-mv]'), tg = e.target.closest('[data-tg]'), rm = e.target.closest('[data-rm]');
    if (mv) { const ids = d.images.map((x) => x.id); const i = ids.indexOf(+mv.dataset.mv), j = i + +mv.dataset.d; [ids[i], ids[j]] = [ids[j], ids[i]]; guard(async () => { await PUT('/banner/order', { ids }); reload(); }); }
    if (tg) guard(async () => { await PUT(`/banner/${tg.dataset.tg}`, { active: +tg.dataset.on }); reload(); });
    if (rm && confirm('Delete this picture?')) guard(async () => { await DEL(`/banner/${rm.dataset.rm}`); reload(); }, 'Deleted');
  });
};

// ---------- fleet ----------
const VEH_F = [{ k: 'name', l: 'Name', req: 1 }, { k: 'category', l: 'Category', t: 'select', o: ['Coach Bus', 'Party Bus', 'Trolley', 'Limo', 'Sprinter / Shuttle', 'Executive Coach', 'Double Decker', 'Other'].map((x) => [x, x]) }, { k: 'capacity', l: 'Seats', t: 'number' }, { k: 'sort', l: 'Sort order', t: 'number', help: 'Lower shows first' }, { k: 'features', l: 'Features', help: 'comma separated', full: 1 }, { k: 'description', l: 'Description (public)', t: 'textarea', full: 1 }, { k: 'active', l: 'Show on website', t: 'check' }, { sec: 'INTERNAL ONLY. Never shown on the website, in emails, or to customers or drivers.' }, { k: 'operator_url', l: 'Operator site (internal link)', t: 'url', full: 1, help: 'Where you check this vehicle or the operator, e.g. https://...' }, { k: 'internal_pricing', l: 'Marked pricing (internal)', t: 'textarea', rows: 3, full: 1, help: 'What it costs us and what we mark it up to, e.g. cost $150/hr, we charge $195/hr, 5 hr minimum' }, { k: 'internal_notes', l: 'Internal notes', t: 'textarea', rows: 3, full: 1 }];
VIEWS.fleet = async (el) => {
  const rows = await GET('/vehicles');
  el.innerHTML = `<div class="toolbar">${button('+ Vehicle', 'primary', 'id="new"')}${exportBtn('fleet')}<span class="mut sm">Order with the sort number. Upload vehicle photos only: no people in any picture.</span></div>${table([{ h: '', f: (v) => (v.image ? `<img src="${esc(v.image)}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:6px">` : '') }, { h: 'Vehicle', f: (v) => `<span class="bold">${esc(v.name)}</span>` }, { h: 'Category', f: (v) => esc(v.category) }, { h: 'Seats', f: (v) => v.capacity, cls: 'r' }, { h: 'Operator', f: (v) => (v.operator_url ? `<a href="${esc(v.operator_url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Open</a>` : '') }, { h: 'Order', f: (v) => v.sort, cls: 'r' }, { h: 'Site', f: (v) => (v.active ? badge('live') : badge('hidden')) }], rows, { onClick: 1 })}`;
  $('#new', el).onclick = () => vehModal();
  bindRows(el, rows, vehModal);
};
function vehModal(v) {
  let imgs = []; try { imgs = JSON.parse(v?.images || '[]'); } catch { /* none */ } if (!imgs.length && v?.image) imgs = [v.image];
  const m = simpleModal(v ? v.name : 'New vehicle', VEH_F, v, '/vehicles');
  $('.mb', m.ov).insertAdjacentHTML('beforeend', `<div class="full" style="margin-top:14px"><div class="fsec">Photos (vehicle only, no people)</div>
    <p class="mut sm" style="margin:4px 0 8px">The first photo is the cover shown on cards. Drag a photo to reorder, or use the arrows. Every photo gets the logo on it when shown on the site.</p>
    <label class="btn" style="cursor:pointer">+ Add photos<input type="file" id="img" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label>
    <div id="gal" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-top:10px"></div></div>`);
  let dragFrom = -1;
  const draw = () => {
    $('#gal', m.ov).innerHTML = imgs.length ? imgs.map((u, i) => `<div draggable="true" data-i="${i}" style="border:2px solid ${i === 0 ? '#94bf33' : 'var(--line,#dfe8ee)'};border-radius:10px;padding:6px;background:#fff;cursor:grab"><img src="${esc(u)}" alt="" draggable="false" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block;pointer-events:none">
      <div class="sm" style="margin:5px 0 3px;font-weight:700">${i === 0 ? 'Cover' : `Photo ${i + 1}`}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${i > 0 ? `<button type="button" class="btn sm" data-mk="${i}">Make cover</button>` : ''}<button type="button" class="btn sm" data-mv="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move earlier">&larr;</button><button type="button" class="btn sm" data-mv="${i}" data-d="1" ${i === imgs.length - 1 ? 'disabled' : ''} aria-label="Move later">&rarr;</button><button type="button" class="btn sm danger" data-rm="${i}">Remove</button></div></div>`).join('') : '<div class="empty" style="grid-column:1/-1">No photos yet. The site shows a drawing of the vehicle until you add one.</div>';
  };
  const move = (from, to) => { if (from === to || from < 0 || to < 0 || to >= imgs.length) return; const [x] = imgs.splice(from, 1); imgs.splice(to, 0, x); draw(); };
  const gal = $('#gal', m.ov);
  gal.addEventListener('click', (e) => { const mk = e.target.closest('[data-mk]'), mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]'); if (mk) move(+mk.dataset.mk, 0); if (mv) move(+mv.dataset.mv, +mv.dataset.mv + +mv.dataset.d); if (rm) { imgs.splice(+rm.dataset.rm, 1); draw(); } });
  gal.addEventListener('dragstart', (e) => { const t = e.target.closest('[data-i]'); if (!t) return; dragFrom = +t.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
  gal.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); const t = e.target.closest('[data-i]'); gal.querySelectorAll('[data-i]').forEach((x) => { x.style.outline = x === t ? '2px dashed #0078c0' : ''; }); } });
  gal.addEventListener('drop', (e) => { e.preventDefault(); const t = e.target.closest('[data-i]'); if (t) move(dragFrom, +t.dataset.i); dragFrom = -1; });
  gal.addEventListener('dragend', () => { dragFrom = -1; gal.querySelectorAll('[data-i]').forEach((x) => { x.style.outline = ''; }); });
  $('#img', m.ov).onchange = (e) => guard(async () => { for (const f of e.target.files) { const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'content-type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); imgs.push(j.url); draw(); } e.target.value = ''; }, 'Uploaded. Click Save to keep them.');
  const old = $('#save', m.ov); const nb = old.cloneNode(true); old.replaceWith(nb);
  nb.onclick = () => guard(async () => { const o = readForm(VEH_F, m.ov); if (!reqCheck(VEH_F, o)) return; o.images = imgs; o.image = imgs[0] || ''; v ? await PUT('/vehicles/' + v.id, o) : await POST('/vehicles', o); m.close(); await refresh(); }, 'Saved');
  draw();
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
  el.innerHTML = `<div class="toolbar">${exportBtn('contracts')}<span class="mut sm">Customers sign automatically when they accept a quote online. Create one for any trip from the trip screen.</span></div>${table([{ h: 'Agreement', f: (k) => `<span class="bold">#${k.seq || k.id}</span><br><span class="mut sm">${esc(k.number)}</span>` }, { h: 'Customer', f: (k) => esc(k.customer_name) }, { h: 'Trip', f: (k) => esc(k.trip_ref || '-') }, { h: 'Total', f: (k) => usd(k.total_cents), cls: 'r' }, { h: 'Status', f: (k) => badge(k.status === 'signed' ? 'accepted' : k.status).replace(/>[^<]*</, `>${esc(k.status)}<`) }, { h: 'Signed', f: (k) => (k.signed_at ? `${esc(k.signer_name)}<br><span class="mut sm">${ago(k.signed_at)}</span>` : '-') }, { h: '', f: (k) => (k.status === 'signed' ? `<a class="btn sm" href="/api/admin/contracts/${k.id}/pdf" target="_blank">PDF</a>` : `<button class="btn sm" data-send="${k.id}">${k.status === 'draft' ? 'Send' : 'Re-send'}</button> <button class="btn sm danger" data-void="${k.id}">Void</button>`) }], rows, { empty: 'No agreements yet.' })}`;
  el.addEventListener('click', (e) => { const s1 = e.target.closest('[data-send]'); const v = e.target.closest('[data-void]'); if (s1) guard(async () => { await POST(`/contracts/${s1.dataset.send}/send`); reload(); }, 'Sent'); if (v && confirm('Void this agreement?')) guard(async () => { await POST(`/contracts/${v.dataset.void}/void`); reload(); }); });
};
VIEWS.messages = async (el) => {
  let type = 'all', q = '';
  const draw = async () => {
    const rows = await GET(`/messages-sent?type=${type}&q=${encodeURIComponent(q)}`);
    $('#list', el).innerHTML = table([{ h: 'When', f: (m) => `${ago(m.at)}<br><span class="mut sm">${fmt(m.at)}</span>` }, { h: 'Type', f: (m) => (m.type === 'email' ? '<span class="badge b-b">email</span>' : `<span class="badge b-a">text${m.direction === 'in' ? ' in' : ''}</span>`) }, { h: 'To', f: (m) => esc(m.to) }, { h: 'Subject or message', f: (m) => `<span class="clip">${esc(m.title)}</span>` }, { h: 'Status', f: (m) => badge(m.status === 'sent' || m.status === 'received' ? 'paid' : m.status === 'logged' || m.status === 'queued' ? 'pending' : m.status).replace(/>[^<]*</, `>${esc(m.status)}<`) }], rows, { onClick: 1, empty: 'No messages yet.' });
    bindRows($('#list', el), rows, (m) => (m.type === 'email' ? emailView(m.id) : smsView(m.id)));
  };
  el.innerHTML = `<div class="toolbar">${chips([['all', 'Everything'], ['email', 'Emails'], ['sms', 'Texts']], type)}<input type="search" id="q" placeholder="Search recipient, subject or text...">${button('Write email', 'primary', 'id="w"')}${button('Write text', 'primary', 'id="wt"')}${exportBtn('emails', 'Export emails')}${exportBtn('texts', 'Export texts')}</div><p class="mut sm">Every email and text the system sends, exactly as the person received it. Click one to see it.</p><div id="list"></div>`;
  $('#chips', el).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; type = b.dataset.k; $$('.chip', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  let tm; $('#q', el).oninput = (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); };
  $('#w', el).onclick = () => composeEmail({});
  $('#wt', el).onclick = () => composeSms({ onDone: draw });
  await draw();
};
/** Write a text to a customer or to any phone number. */
function composeSms({ to = '', customer_id = '', onDone } = {}) {
  modal({ title: 'Write a text', small: true, body: `<p class="mut sm">Sent from your SimpleSender number. Customers who replied STOP cannot be texted.</p>
    <div class="fgrid"><label class="full">Customer (optional)<select id="tc">${custOpts().map(([k, l], i) => [k, i === 0 ? '(none, use the number below)' : l]).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(customer_id) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="full">Or a phone number<input id="tp" type="tel" value="${esc(to)}" placeholder="10 digit number"></label>
    <label class="full">Message<textarea id="tm" rows="5" maxlength="600" placeholder="Type your text"></textarea><span class="hint" id="tn">0 characters</span></label></div>`,
  footer: `<span class="sp"></span>${button('Send text', 'primary', 'id="go"')}`, onMount(ov, close) {
    $('#tm', ov).oninput = (e) => { const n = e.target.value.length; $('#tn', ov).textContent = `${n} characters, ${Math.max(1, Math.ceil(n / 160))} text${n > 160 ? 's' : ''}`; };
    $('#tc', ov).onchange = (e) => { $('#tp', ov).disabled = !!e.target.value; };
    $('#tp', ov).disabled = !!customer_id;
    $('#go', ov).onclick = () => guard(async () => { await POST('/messages/text', { customer_id: $('#tc', ov).value || null, to: $('#tp', ov).value, message: $('#tm', ov).value }); close(); onDone?.(); }, 'Text sent');
  } });
}
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
    <div class="phone"><div class="bubble ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.body)}</div><div class="bubble-t">${fmt(m.created_at)}</div></div>`, footer: `<span class="sp"></span>${button(m.direction === 'in' ? 'Reply' : 'Text again', 'primary', 'id="rp"')}`, onMount(ov, close) { $('#rp', ov).onclick = () => { close(); composeSms({ to: m.to_phone, customer_id: m.customer_id || '' }); }; } });
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
  const F = [{ sec: 'Business' }, { k: 'business_name', l: 'Business name' }, { k: 'phone', l: 'Phone' }, { k: 'email', l: 'Public email' }, { k: 'address', l: 'Address (shown if filled)', places: 1 }, { k: 'service_area', l: 'Service area', full: 1 }, { sec: 'Money defaults' }, { k: 'tax_rate', l: 'Default tax %', t: 'number', step: 0.001 }, { k: 'deposit_pct', l: 'Default deposit %', t: 'number' }, { k: 'quote_valid_days', l: 'Quote valid (days)', t: 'number' }, { k: 'invoice_due_days', l: 'Invoice due (days)', t: 'number' }, { sec: 'Texts, reviews & agreements' }, { k: 'sms_enabled', l: 'Text messages', t: 'select', o: [['1', 'On (opted-in customers only)'], ['0', 'Off']] }, { k: 'sms_quiet_mode', l: 'No automatic texts during', t: 'select', o: [['zmanim', 'Shabbos and Yom Tov (real candle lighting to havdalah)'], ['weekly', 'A fixed weekly window']], help: 'Reminders wait and go out after it ends' }, { k: 'candle_mins', l: 'Candle lighting, minutes before sunset', t: 'number' }, { k: 'havdalah_mins', l: 'Havdalah, minutes after sunset', t: 'number', help: '50 is common. Use 72 for Rabbeinu Tam.' }, { k: 'sms_quiet_start', l: 'Fixed weekly window starts', help: 'Only if you chose a fixed window, e.g. Fri 14:00' }, { k: 'sms_quiet_end', l: 'Fixed weekly window ends', help: 'e.g. Sat 21:30' }, { k: '_sg', t: 'custom', html: '<div class="fsec">Automatic texts to customers (only to customers who agreed)</div><div id="sgbox" style="display:flex;flex-wrap:wrap;gap:6px 18px"></div>' },  { k: 'sms_own_number', l: 'Our SimpleSender number', help: '10 digits. Needed so replies and STOP are picked up.' }, { k: 'google_review_url', l: 'Google review link', full: 1, help: 'Your Google Business "write a review" link. It goes in thank-you emails and texts.' }, { k: 'require_signature', l: 'Customers must sign to accept a quote', t: 'select', o: [['1', 'Yes (recommended)'], ['0', 'No, a click is enough']] }, { k: 'trip_purposes', l: 'Trip purposes on the booking form', full: 1, help: 'comma separated' }, { sec: 'Bus routing: vehicle size, used to avoid roads closed to buses' }, { k: 'bus_height_cm', l: 'Height (cm)', t: 'number', help: 'Typical coach 370' }, { k: 'bus_width_cm', l: 'Width (cm)', t: 'number', help: 'Typical coach 260' }, { k: 'bus_length_cm', l: 'Length (cm)', t: 'number', help: 'Typical 45 ft coach 1370' }, { k: 'bus_weight_kg', l: 'Weight (kg)', t: 'number', help: 'Typical coach 18000' }, { sec: 'Email' }, { k: 'email_from', l: 'Send-from address', help: 'e.g. Get A Bus NY <quotes@getabusny.com> (must be verified in Resend)' }, { k: 'notify_email', l: 'Alerts go to', t: 'email', help: 'new leads, payments, vendor replies. Defaults to public email' }, { sec: 'Automatic follow-ups' }, { k: 'fu_enabled', l: 'Automation on', t: 'select', o: [['1', 'On'], ['0', 'Off']] }, { k: 'fu_quote_days', l: 'Quote nudges, days after sending', help: 'comma separated, blank = none' }, { k: 'fu_invoice_before_days', l: 'Invoice reminders, days before due' }, { k: 'fu_invoice_after_days', l: 'Overdue reminders, days after due' }, { k: 'fu_trip_confirm_hours', l: 'Trip reminder, hours before pickup', t: 'number' }, { k: 'fu_trip_thanks_days', l: 'Thank-you, days after trip', t: 'number' }, { k: 'fu_rfq_hours', l: 'Vendor reminder, hours after request', t: 'number' }, { sec: 'Driver portal' }, { k: 'driver_window_before_hrs', l: 'Unlock customer contact, hours before', t: 'number' }, { k: 'driver_window_after_hrs', l: 'Keep unlocked, hours after trip', t: 'number' }, { sec: 'Chesky (website chat)' }, { k: 'chesky_public', l: 'Show chat on website', t: 'select', o: [['1', 'Yes'], ['0', 'No']] }, { k: 'chesky_name', l: 'Assistant name' }, { k: 'chesky_extra', l: 'Extra instructions for Chesky', t: 'textarea', full: 1, help: 'e.g. current promotions, areas you do not serve, minimum hours' }];
  el.innerHTML = `<div class="panel"><h3>General settings</h3>${formHTML(F, s)}
  <div class="fsec" style="margin-top:18px">Hours of operation (shown on site)</div>${days.map((d) => { const h = hours.find((x) => x.day === d) || { open: '', close: '' }; return `<div style="display:grid;grid-template-columns:110px 1fr 1fr;gap:8px;margin:4px 0;align-items:center"><b>${d}</b><input data-h="${d}" data-w="open" value="${esc(h.open)}" placeholder="10:00 AM (blank = closed)"><input data-h="${d}" data-w="close" value="${esc(h.close)}" placeholder="7:00 PM"></div>`; }).join('')}
  <div class="fsec" style="margin-top:18px">Social links</div><div class="fgrid">${['twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'google'].map((k) => `<label>${k}<input data-soc="${k}" value="${esc(soc[k] || '')}" placeholder="https://"></label>`).join('')}</div>
  <p style="margin-top:16px">${button('Save settings', 'primary', 'id="save"')}</p></div>
  <div class="panel"><h3>Dispatch calendar</h3><p class="mut">Subscribe once and every trip appears (and updates) in Google Calendar, Apple Calendar or Outlook. In Google Calendar: Other calendars → From URL.</p><div id="calbox" class="mut">Loading…</div></div>
  <div class="panel"><h3>Export to Excel</h3><p class="mut">Download any table, or everything in one workbook.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn primary" href="/api/admin/export/all" download>Everything (one workbook)</a>${['customers', 'leads', 'quotes', 'quote_lines', 'trips', 'stops', 'invoices', 'invoice_lines', 'payments', 'contracts', 'vendors', 'rfqs', 'drivers', 'fleet', 'followups', 'messages', 'texts', 'traffic', 'activity'].map((k) => exportBtn(k, k.replace('_', ' '))).join('')}</div></div>
  <div class="panel"><h3>Email check</h3><div id="emhealth" class="mut">Checking...</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:12px"><label style="flex:1;min-width:220px">Send a test email to<input id="emto" type="email" placeholder="you@example.com"></label><button type="button" class="btn primary" id="emgo">Send test</button></div><div id="emres" style="margin-top:10px"></div></div>
  <div class="panel"><h3>Integrations</h3><table class="tbl"><tbody>${st(intg.stripe, 'Stripe payments', 'Set STRIPE_SECRET_KEY on the server')}${st(intg.stripe_webhook, 'Stripe webhook', `Set STRIPE_WEBHOOK_SECRET; endpoint: ${location.origin}/api/stripe/webhook (event: checkout.session.completed, charge.refunded)`)}${st(intg.email, `Email sending${intg.email_provider ? ' (' + intg.email_provider + ')' : ''}`, 'Set BREVO_API_KEY (or RESEND_API_KEY). Until then emails are only logged in Activity → Outbox')}${st(intg.maps, 'Google Maps address suggestions', 'Set GOOGLE_MAPS_API_KEY (Places API New + Routes API enabled)')}${st(intg.sms, 'Text messages (SimpleSender)', 'Set SMS_API_BASE and SMS_API_KEY (SimpleSender dashboard, Developer, Docs and Keys). Add your number below so replies and STOP are picked up')}${st(intg.here, 'Bus-safe routing (HERE)', 'Set HERE_API_KEY. Without it routes use Google and are not bus aware')}${st(intg.chesky, 'Chesky AI', 'Set CHESKY_API_KEY (its own Anthropic key)')}</tbody></table></div>
  <div class="panel"><h3>Team logins</h3>${table([{ h: 'Name', f: (u) => esc(u.name) }, { h: 'Email', f: (u) => esc(u.email) }, { h: 'Phone', f: (u) => esc(u.phone || '') }, { h: '', f: (u) => `<button class="btn sm" data-notify="${u.id}">Alerts</button> ${u.id === me.user.id ? '<span class="mut sm">you</span>' : `<button class="btn sm danger" data-du="${u.id}">Remove</button>`}` }], users)}
   <div class="fgrid" style="margin-top:12px"><label>New user email<input id="ue" type="email"></label><label>Name<input id="un"></label><label>Password (10+ chars)<input id="up" type="password" autocomplete="new-password"></label><label>&nbsp;${button('Add user', '', 'id="addu"')}</label></div>
   <div class="fsec" style="margin-top:18px">Change my password</div><div class="fgrid"><label>Current<input id="pc" type="password" autocomplete="current-password"></label><label>New (10+ chars)<input id="pn" type="password" autocomplete="new-password"></label></div><p>${button('Change password', '', 'id="chpw"')}</p></div>`;
  GET('/email/health').then((h) => { $('#emhealth', el).innerHTML = `<p>Service: <b>${esc(h.provider || 'none connected')}</b>. Sending from: <b>${esc(h.from)}</b></p>${h.warnings.map((w) => `<div class="alert-bad" style="margin:6px 0">${esc(w)}</div>`).join('')}${h.failed.length ? `<p><b>Recent failed sends</b></p>${h.failed.map((f) => `<div class="sm" style="margin:4px 0">${esc(fmt(f.created_at))} to ${esc(f.to_addr)}: <span style="color:#b3261e">${esc(f.error || 'failed')}</span></div>`).join('')}` : (h.warnings.length ? '' : '<div class="alert-ok">No failed sends.</div>')}`; }).catch(() => {});
  $('#emgo', el).onclick = async () => { const out = $('#emres', el); out.textContent = 'Sending...'; try { const r = await POST('/email/test', { to: $('#emto', el).value }); out.innerHTML = r.ok ? '<div class="alert-ok">Sent. Check that inbox, and the spam folder.</div>' : `<div class="alert-bad">Not sent: ${esc(r.error || r.status)}</div>`; } catch (e) { out.innerHTML = `<div class="alert-bad">${esc(e.message)}</div>`; } };
  placesFor(el);
  $('#sgbox', el).innerHTML = Object.entries(SMS_GROUP_LABELS).map(([k, l]) => `<label style="flex-direction:row;display:flex;gap:6px;align-items:center;font-weight:500"><input type="checkbox" data-sgo="${k}" ${String(s.sms_groups_on || '').split(',').includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('');
  el.addEventListener('click', (e) => { const n = e.target.closest('[data-notify]'); if (n) notifyModal(+n.dataset.notify); });
  GET('/calendar-link').then((c) => { $('#calbox', el).innerHTML = `<p><b>All trips (staff)</b><div class="copybox"><input readonly value="${esc(c.staff)}" onclick="this.select()"></div></p>${c.drivers.map((d) => `<p><b>${esc(d.name)}</b> (that driver's trips only)<div class="copybox"><input readonly value="${esc(d.url)}" onclick="this.select()"></div></p>`).join('')}<p class="hint">Anyone with a link can see those trips, so treat it like a password. <button class="link" id="calregen">Replace the staff link</button></p>`; $('#calregen', el)?.addEventListener('click', () => { if (confirm('The old staff link stops working. Continue?')) guard(async () => { await POST('/calendar-link/regenerate'); reload(); }); }); }).catch(() => {});
  $('#save', el).onclick = () => guard(async () => {
    const o = readForm(F, el);
    o.sms_groups_on = $$('[data-sgo]:checked', el).map((x) => x.dataset.sgo).join(',');
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
