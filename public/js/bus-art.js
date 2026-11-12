// Vehicle illustrations and seat maps, drawn in code so every vehicle looks right with no photos.
// Side views only. No people anywhere.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INK = '#0f1c26', LIME = '#94bf33', BLUE = '#0078c0';

function wheel(cx, cy, r, spin) {
  const spokes = [0, 60, 120, 180, 240, 300].map((a) => `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos((a * Math.PI) / 180) * (r - 6)}" y2="${cy + Math.sin((a * Math.PI) / 180) * (r - 6)}" stroke="#7d8b96" stroke-width="3"/>`).join('');
  return `<g><path d="M${cx - r - 8} ${cy} a${r + 8} ${r + 8} 0 0 1 ${(r + 8) * 2} 0z" fill="#06090c"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#111820"/><g class="${spin ? 'spin' : ''}"><circle cx="${cx}" cy="${cy}" r="${r - 7}" fill="#c9d2d9"/>${spokes}<circle cx="${cx}" cy="${cy}" r="6" fill="#3b4752"/></g></g>`;
}
const glassShine = (x, y, w, h) => `<polygon points="${x + w * 0.15},${y} ${x + w * 0.45},${y} ${x + w * 0.2},${y + h} ${x - w * 0.1},${y + h}" fill="#fff" opacity=".16"/>`;

function coach(cap, spin) {
  const n = Math.max(4, Math.min(9, Math.round(cap / 7)));
  const x0 = 82, x1 = 520, w = (x1 - x0) / n;
  let panes = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; panes += `<rect x="${x + 3}" y="64" width="${w - 6}" height="50" rx="5" fill="#1b3a57"/>${glassShine(x + 6, 64, w - 12, 50)}`; }
  return `<ellipse cx="320" cy="210" rx="285" ry="9" fill="#000" opacity=".14"/>
  <path d="M26 68 Q26 40 54 40 H556 Q600 40 614 84 L622 150 V180 H26Z" fill="#fff" stroke="${INK}" stroke-width="3"/>
  <path d="M26 138 H622 V160 H26Z" fill="${LIME}"/><path d="M26 160 H622 V180 H26Z" fill="${BLUE}"/>
  <path d="M26 130 Q300 118 622 138 V146 Q300 128 26 140Z" fill="#fff" opacity=".6"/>
  <rect x="${x0 - 6}" y="58" width="${x1 - x0 + 12}" height="62" rx="8" fill="#0d2234"/>${panes}
  <path d="M530 60 H594 Q604 60 607 78 L616 124 H530Z" fill="#1b3a57" stroke="${INK}" stroke-width="2"/>${glassShine(536, 60, 70, 64)}
  <rect x="540" y="44" width="52" height="12" rx="2" fill="#06090c"/><rect x="545" y="48" width="42" height="4" fill="#ffb41f"/>
  <rect x="566" y="128" width="40" height="46" rx="3" fill="#dfe6ea" stroke="${INK}" stroke-width="2"/><rect x="570" y="132" width="14" height="34" fill="#1b3a57"/><rect x="587" y="132" width="14" height="34" fill="#1b3a57"/>
  <rect x="150" y="124" width="150" height="48" rx="3" fill="none" stroke="${INK}" stroke-width="2"/><rect x="310" y="124" width="150" height="48" rx="3" fill="none" stroke="${INK}" stroke-width="2"/>
  <rect x="236" y="30" width="110" height="12" rx="5" fill="#dfe6ea" stroke="${INK}" stroke-width="2"/>
  <rect x="612" y="150" width="14" height="16" rx="3" fill="#ffd25e"/><rect x="618" y="172" width="12" height="8" fill="#3b4752"/><rect x="618" y="86" width="14" height="8" rx="2" fill="#c0392b" opacity="0"/>
  <path d="M596 70 l22 -10 v22z" fill="#c9d2d9" opacity="0"/>
  ${wheel(140, 182, 29, spin)}${wheel(486, 182, 29, spin)}${wheel(412, 182, 29, spin)}`;
}
function party(cap, spin) {
  const n = Math.max(4, Math.min(8, Math.round(cap / 6)));
  const x0 = 70, x1 = 520, w = (x1 - x0) / n;
  let panes = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; panes += `<rect x="${x + 4}" y="70" width="${w - 8}" height="42" rx="4" fill="#243a50"/>${glassShine(x + 8, 70, w - 16, 42)}`; }
  return `<ellipse cx="320" cy="210" rx="285" ry="9" fill="#000" opacity=".14"/>
  <rect x="26" y="50" width="590" height="128" rx="14" fill="#14232f" stroke="${INK}" stroke-width="3"/>
  <rect x="26" y="50" width="590" height="14" rx="7" fill="#1d3345"/>
  ${panes}
  <path d="M530 66 H600 Q610 66 612 80 L616 122 H530Z" fill="#243a50"/>${glassShine(538, 66, 66, 58)}
  <rect x="26" y="136" width="590" height="5" fill="${LIME}"/><rect x="26" y="146" width="590" height="3" fill="${BLUE}"/>
  <g fill="#ffd25e">${Array.from({ length: 12 }, (_, i) => `<circle cx="${60 + i * 46}" cy="57" r="3"/>`).join('')}</g>
  <rect x="150" y="154" width="130" height="20" rx="3" fill="none" stroke="#3a566e" stroke-width="2"/><rect x="290" y="154" width="130" height="20" rx="3" fill="none" stroke="#3a566e" stroke-width="2"/>
  <rect x="566" y="128" width="40" height="46" rx="3" fill="#243a50" stroke="#3a566e" stroke-width="2"/>
  <rect x="610" y="146" width="14" height="14" rx="3" fill="#ffd25e"/><rect x="616" y="170" width="10" height="8" fill="#3b4752"/>
  ${wheel(140, 182, 29, spin)}${wheel(490, 182, 29, spin)}`;
}
function trolley(cap, spin) {
  const n = Math.max(4, Math.min(8, Math.round(cap / 5)));
  const x0 = 70, x1 = 548, w = (x1 - x0) / n;
  let win = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; win += `<path d="M${x + 5} 128 V84 Q${x + 5} 66 ${x + w / 2} 66 Q${x + w - 5} 66 ${x + w - 5} 84 V128Z" fill="#f3e6c5" stroke="#6b3f17" stroke-width="3"/><rect x="${x + 10}" y="100" width="${w - 20}" height="9" rx="3" fill="#b88a4a" opacity=".7"/>`; }
  return `<ellipse cx="320" cy="210" rx="285" ry="9" fill="#000" opacity=".14"/>
  <rect x="40" y="52" width="566" height="124" rx="10" fill="${BLUE}" stroke="${INK}" stroke-width="3"/>
  <path d="M26 56 Q26 30 54 30 H592 Q624 30 624 58 V62 H26Z" fill="${LIME}" stroke="${INK}" stroke-width="3"/>
  <rect x="60" y="22" width="500" height="10" rx="4" fill="#6b3f17"/>${[100, 220, 340, 460].map((x) => `<rect x="${x}" y="12" width="6" height="12" fill="#6b3f17"/><circle cx="${x + 3}" cy="10" r="5" fill="#ffd25e"/>`).join('')}
  ${win}
  <rect x="40" y="132" width="566" height="12" fill="#6b3f17"/><rect x="40" y="146" width="566" height="30" fill="#00629c"/>
  <rect x="560" y="70" width="42" height="104" rx="4" fill="#f3e6c5" stroke="#6b3f17" stroke-width="3"/><rect x="566" y="76" width="30" height="40" fill="#1b3a57" opacity=".5"/>
  <path d="M608 168 h26 l-8 14 h-18z" fill="#6b3f17"/><rect x="612" y="140" width="14" height="14" rx="7" fill="#ffd25e"/>
  ${wheel(130, 184, 24, spin)}${wheel(470, 184, 24, spin)}`;
}
function limo(cap, spin) {
  return `<ellipse cx="320" cy="210" rx="285" ry="9" fill="#000" opacity=".14"/>
  <path d="M30 150 V112 Q30 100 44 98 L78 94 L112 62 Q120 54 134 54 H462 Q476 54 484 64 L506 96 L588 102 Q612 106 614 130 V160 H30Z" fill="#171f27" stroke="${INK}" stroke-width="3"/>
  <path d="M120 96 L146 66 H210 V96Z" fill="#33516a"/><rect x="216" y="66" width="86" height="30" fill="#33516a"/><rect x="308" y="66" width="86" height="30" fill="#33516a"/><path d="M400 66 H462 L488 96 H400Z" fill="#33516a"/>
  ${glassShine(220, 66, 80, 30)}${glassShine(312, 66, 80, 30)}
  <rect x="30" y="122" width="584" height="5" fill="${LIME}"/><rect x="30" y="130" width="584" height="3" fill="${BLUE}"/>
  <rect x="594" y="112" width="20" height="22" rx="3" fill="#ffd25e"/><rect x="578" y="140" width="40" height="8" rx="2" fill="#aeb8c0"/>
  <g stroke="#aeb8c0" stroke-width="2">${[0, 1, 2, 3, 4].map((i) => `<line x1="${598 + i * 0}" y1="${116 + i * 4}" x2="${614}" y2="${116 + i * 4}"/>`).join('')}</g>
  ${wheel(140, 160, 30, spin)}${wheel(500, 160, 30, spin)}`;
}

export function vehicleArt(category = '', capacity = 30, { spin = false, label = '' } = {}) {
  const c = String(category).toLowerCase();
  const body = c.includes('trolley') ? trolley(capacity, spin) : c.includes('limo') ? limo(capacity, spin) : c.includes('party') || c.includes('sprinter') ? party(capacity, spin) : coach(capacity, spin);
  return `<svg viewBox="0 0 650 225" role="img" aria-label="${esc(label || category)} illustration" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Seat layout drawn to scale: 2 + 2 across, one column per row, front of bus on the right. */
export function seatMap(capacity = 40) {
  const cols = Math.ceil(capacity / 4), s = 7, g = 3, pitch = s + g, w = cols * pitch + 14, h = 44;
  let seats = '', left = capacity;
  for (let c = 0; c < cols; c++) {
    for (const y of [0, 10, 24, 34]) { if (left <= 0) break; seats += `<rect x="${c * pitch}" y="${y}" width="${s}" height="${s}" rx="1.5" fill="${INK}"/>`; left--; }
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="seatmap-svg" role="img" aria-label="Seat layout, ${capacity} seats" xmlns="http://www.w3.org/2000/svg">${seats}<path d="M${cols * pitch + 2} 16 l8 6 l-8 6z" fill="${LIME}"/></svg>`;
}


/* ---------- sharing ---------- */
const SH = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.6-5A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8c-1-.4-2-1.400-2.400-2.400l.8-1-1-2z"/></svg>',
  sms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};
export const shareUrl = (id) => `${location.origin}/bus/${id}`;

/** Markup for a share button. Wire it up once per page with initShare(). */
export function shareButton(v, cls = 'btn btn-line btn-sm') {
  return `<button type="button" class="${cls} sharebtn" data-share="${v.id}" data-name="${esc(v.name)}" data-seats="${v.capacity}" aria-haspopup="menu" aria-expanded="false">${SH.share}<span>Share</span></button>`;
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-999px'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
}

let menu = null, menuBtn = null;
function closeMenu(refocus = true) {
  if (!menu) return;
  menu.remove(); menu = null;
  if (menuBtn) { menuBtn.setAttribute('aria-expanded', 'false'); if (refocus) menuBtn.focus(); menuBtn = null; }
}
function openMenu(btn) {
  closeMenu(false);
  const id = btn.dataset.share, name = btn.dataset.name, seats = btn.dataset.seats;
  const url = shareUrl(id), text = `${name}, ${seats} seats, from Get A Bus NY`;
  const enc = encodeURIComponent;
  menu = document.createElement('div'); menu.className = 'sharemenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `Share ${name}`);
  menu.innerHTML = `<a role="menuitem" href="https://wa.me/?text=${enc(text + ' ' + url)}" target="_blank" rel="noopener">${SH.wa}WhatsApp</a>
    <a role="menuitem" href="sms:?&body=${enc(text + ' ' + url)}">${SH.sms}Text message</a>
    <a role="menuitem" href="mailto:?subject=${enc(name)}&body=${enc(text + '\n' + url)}">${SH.mail}Email</a>
    <button type="button" role="menuitem" data-copy>${SH.copy}<span>Copy link</span></button>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
  menu.style.top = `${window.scrollY + r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - mw - 8))}px`;
  btn.setAttribute('aria-expanded', 'true'); menuBtn = btn;
  const items = [...menu.querySelectorAll('[role=menuitem]')]; items[0].focus();
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  menu.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { const ok = await copyText(url); c.querySelector('span').textContent = ok ? 'Link copied' : 'Copy failed'; setTimeout(() => closeMenu(), 900); }
    else if (e.target.closest('a')) setTimeout(() => closeMenu(false), 50);
  });
}
let wired = false;
export function initShare() {
  if (wired) return; wired = true;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) { if (menu && !menu.contains(e.target)) closeMenu(false); return; }
    e.preventDefault();
    if (menu && menuBtn === b) { closeMenu(); return; }
    const data = { title: b.dataset.name, text: `${b.dataset.name}, ${b.dataset.seats} seats, from Get A Bus NY`, url: shareUrl(b.dataset.share) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } return; }
    openMenu(b);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => closeMenu(false));
}

export function vehicleCard(v, { showRequest = true } = {}) {
  const pic = v.image ? `<img src="${esc(v.image)}" alt="${esc(v.name)}" loading="lazy">` : vehicleArt(v.category, v.capacity, { label: v.name });
  return `<article class="vehicle" data-cat="${esc(v.category)}" data-cap="${v.capacity}"><a class="pic${v.image ? ' ph' : ''}" href="/bus/${v.id}" tabindex="-1" aria-hidden="true">${pic}</a><div class="body">
    <div><span class="tag">${esc(v.category)}</span></div><h3><a href="/bus/${v.id}">${esc(v.name)}</a></h3>
    <div class="spec"><div class="num"><small>SEATS</small>${v.capacity}</div><div class="seatmap">${seatMap(v.capacity)}</div></div>
    <p class="muted" style="margin:0;font-size:.94rem">${esc(v.description || '')}</p>
    <div class="pills">${(v.features || []).slice(0, 6).map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    <div class="foot">${showRequest ? `<a class="btn btn-blue btn-sm" href="/book?vehicle=${v.id}">Get a quote</a>` : ''}${shareButton(v)}</div></div></article>`;
}
