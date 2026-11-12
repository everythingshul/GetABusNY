// Shared site chrome: header, footer, hours helpers, vehicle art, Chesky chat widget.
import { beacon, fillIcons } from '/js/icons.js';
import { initShare } from '/js/bus-art.js';
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (c) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export async function api(path, opts = {}) {
  const r = await fetch('/api/public' + path, { method: opts.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' -> "June 1, 2099" or "June 1, 2099, 7:00 AM". */
export const fmtWhen = (s) => {
  if (!s) return 'Not set';
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/.exec(String(s));
  if (!m) return String(s);
  let out = `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  if (m[4] !== undefined) { let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; out += `, ${h}:${m[5]} ${ap}`; }
  return out;
};

let cfgP;
export const config = () => (cfgP ||= api('/config'));

const ICONS = {
  twitter: ['X / Twitter', 'M18.2 2H21l-6.5 7.4L22 22h-6l-4.7-6.1L5.9 22H3l7-8L2.5 2h6.1l4.3 5.6L18.2 2zm-1 18h1.6L7.7 3.7H6z'],
  facebook: ['Facebook', 'M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.3-1.6 1.7-1.6H17V3.9c-.3 0-1.3-.1-2.4-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.6v3.3h2.8V22z'],
  instagram: ['Instagram', 'M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5-8.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM12 3c-2.4 0-2.7 0-3.7.1-3 .1-4.6 1.7-4.7 4.7C3.5 8.8 3.5 9.1 3.5 12s0 3.200.1 4.200c.1 3 1.700 4.600 4.700 4.700 1 .1 1.300.1 3.700.1s2.700 0 3.700-.1c3-.1 4.600-1.700 4.700-4.700.1-1 .1-1.300.1-4.200s0-3.200-.1-4.200c-.1-3-1.700-4.600-4.700-4.700C14.700 3 14.400 3 12 3z'],
  tiktok: ['TikTok', 'M16.6 2h-3.2v13.300a2.700 2.700 0 1 1-2.700-2.700c.3 0 .6 0 .8.1V9.400a6 6 0 1 0 5.100 5.900V8.600a7 7 0 0 0 4 1.300V6.700a4 4 0 0 1-4-4.700z'],
  youtube: ['YouTube', 'M21.600 7.200a2.500 2.500 0 0 0-1.800-1.800C18.200 5 12 5 12 5s-6.200 0-7.800.4A2.500 2.500 0 0 0 2.400 7.200C2 8.800 2 12 2 12s0 3.200.4 4.800a2.500 2.500 0 0 0 1.800 1.800C5.800 19 12 19 12 19s6.200 0 7.800-.4a2.500 2.500 0 0 0 1.800-1.800c.4-1.600.4-4.800.4-4.800s0-3.200-.4-4.800zM10 15V9l5.200 3z'],
  google: ['Google Reviews', 'M12 10.200v3.900h5.500c-.2 1.400-1.700 4.100-5.500 4.100a6.200 6.200 0 0 1 0-12.400c2 0 3.300.9 4.100 1.600l2.600-2.500A9.800 9.800 0 0 0 12 2.200a9.800 9.800 0 0 0 0 19.600c5.700 0 9.400-4 9.400-9.600 0-.6-.1-1.100-.2-2z'],
};
export function socialLinks(socials) {
  return Object.entries(socials || {}).filter(([k, v]) => v && ICONS[k]).map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener" aria-label="${ICONS[k][0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k][1]}"/></svg></a>`).join('');
}

/** Is the business open right now (Eastern)? Returns text. */
export function openNow(hours) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const t = (s) => { const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(s || ''); if (!m) return null; let h = +m[1] % 12; if (m[3].toUpperCase() === 'PM') h += 12; return h * 60 + +m[2]; };
  const row = hours.find((h) => h.day === p.weekday);
  const mins = (+p.hour % 24) * 60 + +p.minute;
  if (row && row.open) { const o = t(row.open), c = t(row.close); if (mins >= o && mins < c) return { open: true, text: `Open now · until ${row.close}` }; if (mins < o) return { open: false, text: `Opens today at ${row.open}` }; }
  return { open: false, text: 'Closed now' };
}

export { vehicleArt, vehicleCard, seatMap, shareButton, initShare } from '/js/bus-art.js';

/** Compact hours, e.g. "Sun to Thu 10:00 AM to 7:00 PM". */
export function hoursLines(hours) {
  const short = (d) => d.slice(0, 3);
  const groups = [];
  for (const h of hours) {
    const key = h.open ? `${h.open} to ${h.close}` : 'Closed';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(h.day); else groups.push({ key, days: [h.day] });
  }
  return groups.map((g) => `${g.days.length > 1 ? `${short(g.days[0])} to ${short(g.days[g.days.length - 1])}` : short(g.days[0])}: ${g.key}`);
}

export async function boot(active) {
  const c = await config();
  document.documentElement.lang = 'en-US';
  const nav = [['/', 'Home'], ['/fleet', 'Fleet'], ['/about', 'About'], ['/contact', 'Contact'], ['/pay', 'Pay invoice'], ['/driver', 'Drivers']];
  const tel = c.phone.replace(/[^+\d]/g, '');
  const st = openNow(c.hours);
  $('#hdr').innerHTML = `<div class="topbar"><div class="wrap"><span><span class="open-dot ${st.open ? 'on' : ''}"></span>${esc(st.text)}</span><span><a href="tel:${tel}">${esc(c.phone)}</a> &nbsp;&middot;&nbsp; <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span></div></div>
  <header class="site"><div class="wrap"><a class="logo" href="/"><img src="/img/logo.png" alt="${esc(c.business_name)}" width="190" height="44"></a>
  <button class="burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
  <nav class="main" aria-label="Main">${nav.map(([h, t]) => `<a href="${h}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}<a class="btn btn-lime btn-sm" href="/book">Request a quote</a></nav></div></header>`;
  $('.burger').onclick = (e) => { const n = $('nav.main'); const o = n.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); };
  $('#ftr').innerHTML = `<footer class="site"><div class="wrap"><div class="cols">
    <div><span class="logo-w"><img src="/img/logo.png" alt="${esc(c.business_name)}"></span><p>Charter bus broker for camps, shuls, yeshivos and families. In business since 2016.</p><div class="socials">${socialLinks(c.socials)}</div></div>
    <div><h4>Company</h4><ul><li><a href="/about">About us</a></li><li><a href="/fleet">Our fleet</a></li><li><a href="/#areas">Areas we cover</a></li><li><a href="/contact">Contact</a></li><li><a href="/terms">Terms and conditions</a></li><li><a href="/privacy">Privacy</a></li></ul></div>
    <div><h4>Trips</h4><ul><li><a href="/trips/camp-trips">Camp trips</a></li><li><a href="/trips/shabbatons">Shabbatons</a></li><li><a href="/trips/kehila-trips">Kehila trips</a></li><li><a href="/trips/kivrei-tzadikim">Kivrei Tzadikim</a></li><li><a href="/trips/yeshiva-and-school-trips">Yeshiva and school</a></li><li><a href="/trips/chasunos">Chasunos</a></li><li><a href="/trips/simchos">Simchos</a></li></ul></div>
    <div><h4>Customers</h4><ul><li><a href="/book">Request a quote</a></li><li><a href="/pay">Pay an invoice</a></li><li><a href="/driver">Driver portal</a></li></ul></div>
    <div><h4>Office</h4><ul><li><a href="tel:${tel}">${esc(c.phone)}</a></li><li><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>${c.address ? `<li>${esc(c.address)}</li>` : ''}${hoursLines(c.hours).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  </div><div class="legal"><span>&copy; ${new Date().getFullYear()} ${esc(c.business_name)}</span></div></div></footer>`;
  if (c.chesky) import('/js/chesky.js').then((m) => m.initChesky({ name: c.chesky_name, phone: c.phone })).catch(() => {});
  beacon();
  initShare();
  fillIcons();
  return c;
}
