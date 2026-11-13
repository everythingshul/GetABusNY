// Itinerary builder: ordered pickups, stops, drop-offs, return pickups (+ bus start/end for staff).
// Used on the public booking form and inside the admin quote/trip editors.
import { attachPlaces } from '/js/places.js';

const KINDS = { start: 'Bus starts at', pickup: 'Pickup', stop: 'Stop', dropoff: 'Drop-off', return_pickup: 'Return pickup', end: 'Bus ends at' };
const PUBLIC_KINDS = ['pickup', 'stop', 'dropoff', 'return_pickup'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `.itn{display:grid;gap:10px}
.itn-row{position:relative;display:grid;grid-template-columns:22px 34px 1fr;gap:8px;background:var(--itn-bg,#f6f9fb);border:1.5px solid var(--line,#dbe5ec);border-radius:12px;padding:10px 12px}
.itn-row .num{width:30px;height:30px;border-radius:50%;background:var(--blue,#0078c0);color:#fff;font:700 .85rem var(--head,sans-serif);display:grid;place-items:center;margin-top:3px}
.itn-row[data-k=start] .num,.itn-row[data-k=end] .num{background:#6b7f8e}.itn-row[data-k=stop] .num{background:#94bf33;color:#0d1b26}.itn-row[data-k=dropoff] .num{background:#10222f}
.itn-main{display:grid;grid-template-columns:150px 1fr;gap:8px}
.itn-extra{grid-column:1/-1;display:none;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:2px}.itn-row.open .itn-extra{display:grid}
.itn-extra label{font-size:.72rem}.itn-tools{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.itn-tools button{font:600 .78rem var(--head,sans-serif);padding:3px 10px;border-radius:7px;border:1.5px solid var(--line,#dbe5ec);background:#fff;cursor:pointer;min-height:28px;color:inherit}
.itn-tools button:hover{border-color:var(--blue,#0078c0);color:var(--blue,#0078c0)}.itn-tools .rm:hover{border-color:#c0392b;color:#c0392b}
.itn-add{display:flex;gap:8px;flex-wrap:wrap}.itn-add button{font:600 .85rem var(--head,sans-serif);padding:7px 14px;border-radius:9px;border:1.5px dashed var(--blue,#0078c0);background:#fff;color:var(--blue,#0078c0);cursor:pointer;min-height:36px}.itn-add button:hover{background:#e3f1fa}
.itn-hint{font-size:.78rem;color:#5a6e7d}
.itn-grip{width:22px;align-self:start;margin-top:5px;height:30px;border:0;background:none;cursor:grab;touch-action:none;padding:0;display:grid;place-items:center;border-radius:6px}
.itn-grip i{display:block;width:12px;height:16px;background:radial-gradient(circle,#7d90a0 1.6px,transparent 1.8px) 0 0/6px 6px}
.itn-grip:hover i,.itn-grip:focus-visible i{background-image:radial-gradient(circle,#0078c0 1.6px,transparent 1.8px)}.itn-grip:focus-visible{outline:2px solid #0078c0}
.itn-row.dragging{z-index:5;box-shadow:0 14px 30px -10px rgba(13,27,38,.4);border-color:#0078c0;cursor:grabbing;transition:none}
.itn-row.over-before::before,.itn-row.over-after::after{content:'';position:absolute;left:0;right:0;height:4px;border-radius:2px;background:#94bf33}
.itn-row.over-before::before{top:-7px}.itn-row.over-after::after{bottom:-7px}
.itn-tip{display:flex;gap:12px;align-items:center;background:#eef6d9;border:1.5px solid #cfe39a;border-radius:10px;padding:8px 12px;font-size:.84rem;color:#10222f}
.itn-demo{flex:none;width:74px;height:40px;position:relative;overflow:hidden}
.itn-demo b{position:absolute;left:0;right:0;height:11px;border-radius:4px;background:#fff;border:1.5px solid #cfe39a}
.itn-demo b:nth-child(1){top:0;animation:itnA 3.2s ease-in-out infinite}.itn-demo b:nth-child(2){top:14px;border-color:#0078c0;animation:itnB 3.2s ease-in-out infinite;z-index:2}.itn-demo b:nth-child(3){top:28px}
@keyframes itnA{0%,25%{transform:none}45%,75%{transform:translateY(14px)}95%,100%{transform:none}}
@keyframes itnB{0%,25%{transform:none}45%,75%{transform:translateY(-14px)}95%,100%{transform:none}}
@media(prefers-reduced-motion:reduce){.itn-demo b{animation:none!important}}
@media(max-width:640px){.itn-main{grid-template-columns:1fr}.itn-extra{grid-template-columns:1fr 1fr}}`;
  document.head.append(s);
}

/**
 * mount(container, { value: [], staff: false, roundTrip: false })
 * returns { get(), set(arr), setRoundTrip(bool), onChange(fn) }
 */
export function itineraryEditor(box, { value = [], staff = false, roundTrip = false } = {}) {
  css();
  const kinds = staff ? Object.keys(KINDS) : PUBLIC_KINDS;
  let rows = value.length ? value.map((x) => ({ ...x })) : preset(roundTrip);
  let cb = () => {};
  function preset(rt) {
    const r = [{ kind: 'pickup', address: '' }, { kind: 'dropoff', address: '' }];
    if (rt) r.push({ kind: 'return_pickup', address: '', auto: 'dropoff' }, { kind: 'dropoff', address: '', auto: 'pickup' });
    return r;
  }
  const firstOf = (k) => rows.find((x) => x.kind === k);
  function syncAuto() {
    rows.forEach((r) => { if (r.auto) { const src = r.auto === 'dropoff' ? rows.find((x) => x.kind === 'dropoff' && !x.auto) : firstOf('pickup'); if (src) { r.address = src.address; r.place_id = src.place_id; r.lat = src.lat; r.lng = src.lng; } } });
  }
  function draw() {
    syncAuto();
    box.innerHTML = `${rows.length > 1 ? `<div class="itn-tip"><span class="itn-demo" aria-hidden="true"><b></b><b></b><b></b></span><span><b>Change the order:</b> press and hold the dotted handle on the left of a stop, then drag it up or down. Or use the arrow buttons.</span></div>` : ''}<div class="itn">${rows.map((r, i) => `<div class="itn-row ${r.wait_min || r.note || r.pax || r.time || r.contact_name ? 'open' : ''}" data-i="${i}" data-k="${r.kind}">
      <button type="button" class="itn-grip" data-grip aria-label="Drag to reorder stop ${i + 1}" title="Drag to reorder"><i></i></button><div class="num">${i + 1}</div><div class="itn-main">
      <select data-f="kind" aria-label="Stop type">${kinds.map((k) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${KINDS[k]}</option>`).join('')}</select>
      <input data-f="address" data-pl value="${esc(r.address)}" placeholder="${r.kind === 'start' || r.kind === 'end' ? 'Garage / depot address' : 'Start typing an address or place name'}" aria-label="Address" ${r.auto ? `title="Copied from the ${r.auto} above, edit to change"` : ''}></div>
      <div class="itn-extra"><label>${r.kind === 'pickup' || r.kind === 'return_pickup' ? 'Pickup time' : 'Arrive time'}<input type="datetime-local" data-f="time" value="${esc((r.time || '').slice(0, 16))}"></label>
      <label>Wait here (min)<input type="number" min="0" step="5" data-f="wait_min" value="${r.wait_min || ''}"></label>
      <label>Passengers<input type="number" min="0" data-f="pax" value="${r.pax || ''}"></label>
      <label>Note<input data-f="note" value="${esc(r.note || '')}" placeholder="Gate, entrance…"></label>
      ${staff ? `<label>On-site contact<input data-f="contact_name" value="${esc(r.contact_name || '')}"></label><label>Contact phone<input data-f="contact_phone" value="${esc(r.contact_phone || '')}"></label>` : ''}</div>
      <div class="itn-tools"><button type="button" data-a="more">${r.wait_min || r.note || r.pax || r.time ? 'Hide details' : 'Time, wait, notes'}</button><button type="button" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" data-a="down" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>${rows.length > 1 ? '<button type="button" class="rm" data-a="rm" aria-label="Remove stop">Remove</button>' : ''}</div></div>`).join('')}
      <div class="itn-add"><button type="button" data-add="pickup">+ Extra pickup</button><button type="button" data-add="stop">+ Stop</button><button type="button" data-add="dropoff">+ Drop-off</button><button type="button" data-add="return_pickup">+ Return pickup</button>${staff ? '<button type="button" data-add="start">+ Bus start</button><button type="button" data-add="end">+ Bus end</button>' : ''}</div>
      <div class="itn-hint">Stops are in driving order. Each extra pickup, stop and drop-off is quoted by our team.</div></div>`;
    box.querySelectorAll('input[data-pl]').forEach((inp) => {
      const i = +inp.closest('.itn-row').dataset.i;
      attachPlaces(inp, { onPick: (p) => { Object.assign(rows[i], { address: p.address, place_id: p.place_id, lat: p.lat, lng: p.lng }); delete rows[i].auto; syncAuto(); refreshAuto(); cb(); } });
    });
  }
  function refreshAuto() { box.querySelectorAll('.itn-row').forEach((el) => { const r = rows[+el.dataset.i]; if (r.auto) el.querySelector('[data-f=address]').value = r.address || ''; }); }
  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]'); if (!el) return; const i = +el.closest('.itn-row').dataset.i; const f = el.dataset.f;
    if (f === 'kind') return;
    if (f === 'address') { rows[i].address = el.value; delete rows[i].place_id; delete rows[i].lat; delete rows[i].lng; delete rows[i].auto; syncAuto(); refreshAuto(); }
    else rows[i][f] = el.value;
    cb();
  });
  box.addEventListener('change', (e) => { const el = e.target.closest('[data-f=kind]'); if (el) { const i = +el.closest('.itn-row').dataset.i; rows[i].kind = el.value; delete rows[i].auto; draw(); cb(); } });
  box.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { rows.push({ kind: add.dataset.add, address: '' }); draw(); cb(); box.querySelector('.itn-row:last-of-type input[data-f=address]')?.focus(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const row = b.closest('.itn-row'); const i = +row.dataset.i;
    if (b.dataset.a === 'more') row.classList.toggle('open'), (b.textContent = row.classList.contains('open') ? 'Hide details' : 'Time, wait, notes');
    if (b.dataset.a === 'rm') { rows.splice(i, 1); draw(); cb(); }
    if (b.dataset.a === 'up' && i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); cb(); }
    if (b.dataset.a === 'down' && i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); cb(); }
  });
  // drag a stop by its handle (mouse, pen or finger)
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-grip]'); if (!g || (e.button && e.button !== 0)) return;
    const row = g.closest('.itn-row'); e.preventDefault(); g.setPointerCapture(e.pointerId);
    drag = { row, from: +row.dataset.i, y0: e.clientY, to: +row.dataset.i, id: e.pointerId, g };
    row.classList.add('dragging');
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.row.style.transform = `translateY(${e.clientY - drag.y0}px)`;
    const rowsEl = [...box.querySelectorAll('.itn-row')]; rowsEl.forEach((x) => x.classList.remove('over-before', 'over-after'));
    let to = drag.from, pos = null;
    for (const el of rowsEl) { if (el === drag.row) continue; const r = el.getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) { const after = e.clientY > r.top + r.height / 2; to = +el.dataset.i + (after ? 1 : 0); if (to > drag.from) to -= 1; el.classList.add(after ? 'over-after' : 'over-before'); pos = el; break; } }
    drag.to = to;
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
  });
  const endDrag = (e, cancel) => {
    if (!drag) return; const d = drag; drag = null;
    try { d.g.releasePointerCapture(d.id); } catch { /* already released */ }
    d.row.classList.remove('dragging'); d.row.style.transform = '';
    box.querySelectorAll('.over-before,.over-after').forEach((x) => x.classList.remove('over-before', 'over-after'));
    if (!cancel && d.to !== d.from) { const [x] = rows.splice(d.from, 1); rows.splice(d.to, 0, x); draw(); cb(); box.querySelector(`.itn-row[data-i="${d.to}"] [data-grip]`)?.focus(); }
  };
  box.addEventListener('pointerup', (e) => endDrag(e, false)); box.addEventListener('pointercancel', (e) => endDrag(e, true));
  box.addEventListener('keydown', (e) => { const g = e.target.closest('[data-grip]'); if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return; e.preventDefault(); const i = +g.closest('.itn-row').dataset.i, j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j], rows[i]]; draw(); cb(); box.querySelector(`.itn-row[data-i="${j}"] [data-grip]`)?.focus(); });
  draw();
  return {
    get: () => rows.filter((r) => (r.address || '').trim()).map(({ auto, ...r }) => ({ ...r, address: r.address.trim() })),
    set: (arr) => { rows = arr.length ? arr.map((x) => ({ ...x })) : preset(false); draw(); },
    setRoundTrip(rt) { const has = rows.some((r) => r.kind === 'return_pickup'); if (rt && !has && rows.every((r) => !r.address || r.kind === 'pickup' || r.kind === 'dropoff') && rows.length <= 2) { rows.push({ kind: 'return_pickup', address: '', auto: 'dropoff' }, { kind: 'dropoff', address: '', auto: 'pickup' }); draw(); } if (!rt && has && rows.filter((r) => r.auto).length === 2) { rows = rows.filter((r) => !r.auto); draw(); } cb(); },
    onChange: (fn) => { cb = fn; },
  };
}
export const KIND_LABELS = KINDS;
