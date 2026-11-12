// Vehicle illustrations and seat maps, drawn in code: glossy black bodies, rim light, tinted glass and
// accent lines that glow like the lighting inside a coach at night. Side views only. No people anywhere.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LIME = '#94bf33', BLUE = '#0078c0', AMBER = '#ffb41f';
let uid = 0;

/** Shared gradients and filters for one drawing. k is a unique prefix so several SVGs can share a page. */
function defs(k, g) {
  return `<defs>
<linearGradient id="${k}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b4f58"/><stop offset=".07" stop-color="#2b2e35"/><stop offset=".36" stop-color="#15171b"/><stop offset=".78" stop-color="#0a0b0d"/><stop offset="1" stop-color="#040405"/></linearGradient>
<linearGradient id="${k}rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".25" stop-color="#fff" stop-opacity=".55"/><stop offset=".8" stop-color="#cfe9ff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${k}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28435a"/><stop offset=".45" stop-color="#0c1822"/><stop offset="1" stop-color="#04070a"/></linearGradient>
<linearGradient id="${k}wa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe3a1"/><stop offset=".55" stop-color="#e6a23a"/><stop offset="1" stop-color="#7a4510"/></linearGradient>
<linearGradient id="${k}brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d99a"/><stop offset=".5" stop-color="#b98a3e"/><stop offset="1" stop-color="#6a4a1a"/></linearGradient>
<linearGradient id="${k}beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff4cf" stop-opacity=".6"/><stop offset="1" stop-color="#fff4cf" stop-opacity="0"/></linearGradient>
<radialGradient id="${k}rimw" cx=".38" cy=".34" r=".8"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".55" stop-color="#8b959e"/><stop offset="1" stop-color="#22272c"/></radialGradient>
<radialGradient id="${k}amb" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="${LIME}" stop-opacity=".30"/><stop offset=".55" stop-color="${BLUE}" stop-opacity=".16"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
<radialGradient id="${k}fl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${LIME}" stop-opacity=".55"/><stop offset=".6" stop-color="${BLUE}" stop-opacity=".25"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
<linearGradient id="${k}fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="${k}m"><rect x="0" y="${g}" width="700" height="40" fill="url(#${k}fade)"/></mask>
<filter id="${k}glow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${k}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
</defs>`;
}

function wheel(k, cx, cy, r, spin) {
  const spokes = [0, 72, 144, 216, 288].map((a) => `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos((a * Math.PI) / 180) * (r - 8)).toFixed(1)}" y2="${(cy + Math.sin((a * Math.PI) / 180) * (r - 8)).toFixed(1)}" stroke="#4d565e" stroke-width="3.2" stroke-linecap="round"/>`).join('');
  return `<g><path d="M${cx - r - 9} ${cy - 2} a${r + 9} ${r + 9} 0 0 1 ${(r + 9) * 2} 0z" fill="#020203"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b0c0e" stroke="#2a2d33" stroke-width="1.5"/><g class="${spin ? 'spin' : ''}"><circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="url(#${k}rimw)"/>${spokes}<circle cx="${cx}" cy="${cy}" r="6" fill="#2b3036"/></g><circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1"/></g>`;
}
const shine = (x, y, w, h) => `<polygon points="${x + w * 0.2},${y} ${x + w * 0.52},${y} ${x + w * 0.22},${y + h} ${x - w * 0.1},${y + h}" fill="#fff" opacity=".10"/>`;
const lights = (k, front, rear, y = 168) => `<ellipse cx="${front}" cy="${y}" rx="9" ry="6" fill="#fff6d6" filter="url(#${k}glow)"/><polygon points="${front},${y - 6} 700,${y - 34} 700,${y + 40} ${front},${y + 6}" fill="url(#${k}beam)"/><rect x="${rear}" y="${y - 12}" width="8" height="18" rx="3" fill="#ff3b30" filter="url(#${k}glow)"/>`;
const accent = (k, y0, y1, x0 = 26, x1 = 666) => `<path d="M${x0} ${y0} C ${x0 + 240} ${y0 - 12}, ${x1 - 200} ${y1 - 8}, ${x1} ${y1}" fill="none" stroke="${LIME}" stroke-width="4.5" filter="url(#${k}glow)"/><path d="M${x0} ${y0 + 11} C ${x0 + 240} ${y0 - 1}, ${x1 - 200} ${y1 + 3}, ${x1} ${y1 + 11}" fill="none" stroke="${BLUE}" stroke-width="3.5" filter="url(#${k}glow)"/>`;

function coach(k, cap, spin) {
  const n = Math.max(4, Math.min(9, Math.round(cap / 7)));
  const x0 = 80, x1 = 560, w = (x1 - x0) / n;
  let panes = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; panes += `<rect x="${x + 3}" y="64" width="${w - 6}" height="52" rx="6" fill="url(#${k}g)" stroke="#000" stroke-width="1.2"/>${shine(x + 8, 64, w - 14, 52)}<rect x="${x + 3}" y="112" width="${w - 6}" height="3" fill="${LIME}" opacity=".5" filter="url(#${k}glow)"/>`; }
  return `<g id="${k}body">
  <path d="M24 78 Q24 44 58 44 H592 Q642 44 658 98 L670 162 V198 H24 Z" fill="url(#${k}b)" stroke="#000" stroke-width="2"/>
  <path d="M40 46 H590 Q636 46 652 92" fill="none" stroke="url(#${k}rim)" stroke-width="2.2"/>
  <rect x="${x0 - 8}" y="58" width="${x1 - x0 + 16}" height="64" rx="9" fill="#05080b"/>${panes}
  <path d="M572 62 H638 Q650 62 654 84 L664 130 H572 Z" fill="url(#${k}g)" stroke="#000" stroke-width="1.5"/>${shine(578, 62, 74, 68)}
  <rect x="580" y="46" width="62" height="11" rx="2" fill="#030405"/><rect x="585" y="49.5" width="52" height="4" fill="${AMBER}" filter="url(#${k}glow)"/>
  <rect x="566" y="132" width="42" height="64" rx="4" fill="#0d0f12" stroke="#2f333a" stroke-width="1.4"/><rect x="571" y="137" width="14" height="42" fill="url(#${k}g)"/><rect x="589" y="137" width="14" height="42" fill="url(#${k}g)"/>
  <rect x="150" y="136" width="150" height="52" rx="4" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/><rect x="312" y="136" width="150" height="52" rx="4" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>
  <rect x="236" y="34" width="120" height="12" rx="6" fill="#23262c" stroke="#000"/>
  <rect x="652" y="94" width="14" height="9" rx="2" fill="#1b1d22" stroke="#000"/>
  ${accent(k, 150, 164)}${lights(k, 664, 24, 170)}
  ${wheel(k, 140, 184, 29, spin)}${wheel(k, 214, 184, 29, spin)}${wheel(k, 500, 184, 29, spin)}</g>`;
}
function party(k, cap, spin) {
  const n = Math.max(4, Math.min(8, Math.round(cap / 6)));
  const x0 = 72, x1 = 540, w = (x1 - x0) / n;
  let panes = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; panes += `<rect x="${x + 4}" y="74" width="${w - 8}" height="44" rx="4" fill="url(#${k}g)" stroke="#000"/>${shine(x + 8, 74, w - 16, 44)}`; }
  const bulbs = Array.from({ length: 13 }, (_, i) => `<circle cx="${52 + i * 44}" cy="60" r="3" fill="${i % 2 ? '#fff0b8' : AMBER}" filter="url(#${k}glow)"/>`).join('');
  return `<ellipse cx="350" cy="214" rx="300" ry="9" fill="url(#${k}fl)" opacity=".9"/><g id="${k}body">
  <rect x="24" y="52" width="636" height="146" rx="18" fill="url(#${k}b)" stroke="#000" stroke-width="2"/>
  <path d="M44 54 H632" stroke="url(#${k}rim)" stroke-width="2.2" fill="none"/>
  <rect x="34" y="58" width="616" height="10" rx="5" fill="#0c0d10"/>${bulbs}
  ${panes}
  <path d="M552 72 H636 Q650 72 652 90 L656 130 H552 Z" fill="url(#${k}g)" stroke="#000"/>${shine(560, 72, 80, 58)}
  <rect x="566" y="136" width="42" height="60" rx="4" fill="#0d0f12" stroke="#2f333a" stroke-width="1.4"/><rect x="571" y="141" width="32" height="40" fill="url(#${k}g)"/>
  <rect x="26" y="146" width="632" height="5" fill="${LIME}" filter="url(#${k}glow)"/><rect x="26" y="156" width="632" height="3.5" fill="${BLUE}" filter="url(#${k}glow)"/>
  <rect x="150" y="164" width="130" height="24" rx="4" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/><rect x="292" y="164" width="130" height="24" rx="4" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>
  ${lights(k, 656, 24, 172)}
  ${wheel(k, 140, 186, 28, spin)}${wheel(k, 500, 186, 28, spin)}</g>`;
}
function trolley(k, cap, spin) {
  const n = Math.max(4, Math.min(8, Math.round(cap / 5)));
  const x0 = 70, x1 = 548, w = (x1 - x0) / n;
  let win = '';
  for (let i = 0; i < n; i++) { const x = x0 + i * w; win += `<path d="M${x + 6} 132 V92 Q${x + 6} 72 ${x + w / 2} 72 Q${x + w - 6} 72 ${x + w - 6} 92 V132Z" fill="url(#${k}wa)" stroke="url(#${k}brass)" stroke-width="3.2"/><rect x="${x + 11}" y="104" width="${w - 22}" height="9" rx="3" fill="#2a1a08" opacity=".35"/>`; }
  const lant = [110, 230, 350, 470].map((x) => `<rect x="${x}" y="14" width="5" height="12" fill="#6a4a1a"/><circle cx="${x + 2.5}" cy="11" r="5.5" fill="#ffe3a1" filter="url(#${k}glow)"/>`).join('');
  return `<ellipse cx="350" cy="214" rx="300" ry="9" fill="url(#${k}fl)" opacity=".9"/><g id="${k}body">
  <rect x="40" y="58" width="570" height="132" rx="10" fill="url(#${k}b)" stroke="#000" stroke-width="2"/>
  <path d="M24 62 Q24 32 56 32 H596 Q630 32 630 62 V68 H24Z" fill="url(#${k}brass)" stroke="#000" stroke-width="2"/>
  <rect x="60" y="22" width="500" height="10" rx="4" fill="#5b3f17"/>${lant}
  ${win}
  <rect x="40" y="138" width="570" height="12" fill="url(#${k}brass)"/><rect x="40" y="152" width="570" height="38" fill="#0a0b0e"/>
  <rect x="42" y="158" width="566" height="4" fill="${LIME}" filter="url(#${k}glow)"/><rect x="42" y="166" width="566" height="3" fill="${BLUE}" filter="url(#${k}glow)"/>
  <rect x="560" y="76" width="44" height="112" rx="5" fill="url(#${k}wa)" stroke="url(#${k}brass)" stroke-width="3"/>
  <path d="M612 172 h28 l-10 18 h-20z" fill="#5b3f17"/>
  <ellipse cx="624" cy="150" rx="8" ry="8" fill="#fff0c0" filter="url(#${k}glow)"/><rect x="32" y="146" width="8" height="16" rx="3" fill="#ff3b30" filter="url(#${k}glow)"/>
  ${wheel(k, 134, 190, 24, spin)}${wheel(k, 474, 190, 24, spin)}</g>`;
}
function limo(k, cap, spin) {
  return `<ellipse cx="350" cy="214" rx="310" ry="10" fill="url(#${k}fl)" opacity=".95"/><g id="${k}body">
  <path d="M26 164 V122 Q26 106 44 104 L84 100 L124 66 Q134 58 150 58 H470 Q486 58 496 70 L520 104 L610 110 Q640 114 644 140 V170 H26Z" fill="url(#${k}b)" stroke="#000" stroke-width="2"/>
  <path d="M130 68 Q136 62 150 62 H468 Q482 62 490 72" fill="none" stroke="url(#${k}rim)" stroke-width="2"/>
  <path d="M128 100 L152 70 H218 V100Z" fill="url(#${k}g)"/><rect x="224" y="70" width="90" height="30" fill="url(#${k}g)"/><rect x="320" y="70" width="90" height="30" fill="url(#${k}g)"/><path d="M416 70 H472 L498 100 H416Z" fill="url(#${k}g)"/>
  ${shine(228, 70, 84, 30)}${shine(324, 70, 84, 30)}
  <rect x="26" y="130" width="618" height="5" fill="${LIME}" filter="url(#${k}glow)"/><rect x="26" y="139" width="618" height="3.5" fill="${BLUE}" filter="url(#${k}glow)"/>
  <rect x="624" y="116" width="22" height="26" rx="4" fill="#d8dde2"/><g stroke="#8a929a" stroke-width="2">${[0, 1, 2, 3, 4].map((i) => `<line x1="626" y1="${120 + i * 4.6}" x2="644" y2="${120 + i * 4.6}"/>`).join('')}</g>
  <ellipse cx="634" cy="150" rx="8" ry="6" fill="#fff6d6" filter="url(#${k}glow)"/><polygon points="636,146 700,126 700,176 636,154" fill="url(#${k}beam)"/>
  <rect x="26" y="136" width="8" height="16" rx="3" fill="#ff3b30" filter="url(#${k}glow)"/>
  ${wheel(k, 140, 170, 30, spin)}${wheel(k, 500, 170, 30, spin)}</g>`;
}

export function vehicleArt(category = '', capacity = 30, { spin = false, label = '' } = {}) {
  const k = 'v' + uid++;
  const c = String(category).toLowerCase();
  const kind = c.includes('trolley') ? 'trolley' : c.includes('limo') ? 'limo' : c.includes('party') || c.includes('sprinter') ? 'party' : 'coach';
  const body = { trolley, limo, party, coach }[kind](k, capacity, spin);
  const ground = { coach: 213, party: 214, trolley: 214, limo: 200 }[kind];
  const lift = kind === 'limo' ? 12 : 0;
  return `<svg viewBox="0 24 700 226" role="img" aria-label="${esc(label || category)} illustration" xmlns="http://www.w3.org/2000/svg">${defs(k, ground)}
<ellipse cx="350" cy="120" rx="330" ry="108" fill="url(#${k}amb)"/>
<g transform="translate(0 ${lift})">${body}<g mask="url(#${k}m)" opacity=".55"><use href="#${k}body" transform="translate(0 ${ground * 2}) scale(1 -1)"/></g></g></svg>`;
}

/** Seat layout drawn to scale: 2 + 2 across, one column per row, front of the vehicle on the right. Seats glow lime. */
export function seatMap(capacity = 40) {
  const k = 's' + uid++;
  const cols = Math.ceil(capacity / 4), s = 7, g = 3, pitch = s + g, w = cols * pitch + 14, h = 44;
  let seats = '', left = capacity;
  for (let c = 0; c < cols; c++) {
    for (const y of [0, 10, 24, 34]) { if (left <= 0) break; seats += `<rect x="${c * pitch}" y="${y}" width="${s}" height="${s}" rx="1.8"/>`; left--; }
  }
  return `<svg viewBox="-3 -3 ${w + 6} ${h + 6}" class="seatmap-svg" role="img" aria-label="Seat layout, ${capacity} seats" xmlns="http://www.w3.org/2000/svg"><defs><filter id="${k}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g fill="${LIME}" filter="url(#${k})">${seats}</g><path d="M${cols * pitch + 2} 16 l8 6 l-8 6z" fill="${AMBER}" filter="url(#${k})"/></svg>`;
}

export function vehicleCard(v, { showRequest = true } = {}) {
  // An admin-uploaded vehicle photo wins; otherwise the lit illustration for that vehicle type.
  const pic = v.image ? `<div class="pic ph"><img src="${esc(v.image)}" alt="${esc(v.name)}" loading="lazy"></div>` : `<div class="pic">${vehicleArt(v.category, v.capacity, { label: v.name })}</div>`;
  return `<article class="vehicle" data-cat="${esc(v.category)}" data-cap="${v.capacity}">${pic}<div class="body">
    <div><span class="tag">${esc(v.category)}</span></div><h3>${esc(v.name)}</h3>
    <div class="spec"><div class="num"><small>SEATS</small>${v.capacity}</div><div class="seatmap">${seatMap(v.capacity)}</div></div>
    <p class="muted" style="margin:0;font-size:.94rem">${esc(v.description || '')}</p>
    <div class="pills">${(v.features || []).slice(0, 6).map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    ${showRequest ? `<div class="foot"><a class="btn btn-blue btn-sm" href="/book?vehicle=${v.id}">Get a quote</a></div>` : ''}</div></article>`;
}
