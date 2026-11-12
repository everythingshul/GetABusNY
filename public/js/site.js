// Shared site chrome: header, footer, hours helpers, vehicle art, Chesky chat widget.
import { beacon, fillIcons } from '/js/icons.js';
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
export const fmtWhen = (s) => { if (!s) return '—'; const d = new Date(s.length === 10 ? s + 'T00:00:00Z' : s + ':00Z'); return d.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...(s.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}) }); };

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

/** Simple side-view vehicle drawing used when there is no photo. */
export function vehicleArt(cat = '', capacity = 30) {
  const c = cat.toLowerCase();
  const len = Math.min(300, 190 + capacity * 2);
  const x0 = (320 - len) / 2;
  let body = '', wins = '';
  const n = Math.max(3, Math.round(len / 36));
  const ww = (len - 70) / n;
  if (c.includes('coach')) {
    body = `<rect x="${x0}" y="22" width="${len}" height="62" rx="12" fill="#fff" stroke="#10222f" stroke-width="2"/><rect x="${x0}" y="58" width="${len}" height="14" fill="#94bf33"/><rect x="${x0}" y="72" width="${len}" height="12" fill="#0078c0"/>`;
    for (let i = 0; i < n; i++) wins += `<rect x="${x0 + 48 + i * ww}" y="30" width="${ww - 6}" height="22" rx="3" fill="#7fb8dc" stroke="#10222f" stroke-width="1.5"/>`;
    wins += `<path d="M${x0 + len - 4} 30 h-30 v26 h34z" fill="#7fb8dc" stroke="#10222f" stroke-width="1.5"/>`;
  } else if (c.includes('trolley')) {
    body = `<rect x="${x0}" y="28" width="${len}" height="56" rx="8" fill="#0078c0" stroke="#10222f" stroke-width="2"/><rect x="${x0 - 3}" y="18" width="${len + 6}" height="12" rx="4" fill="#94bf33" stroke="#10222f" stroke-width="2"/><rect x="${x0}" y="70" width="${len}" height="8" fill="#94bf33"/>`;
    for (let i = 0; i < n; i++) wins += `<path d="M${x0 + 16 + i * ww} 36 h${ww - 10} v26 h-${ww - 10} z" fill="#dff0fa" stroke="#10222f" stroke-width="1.5"/>`;
  } else if (c.includes('limo')) {
    body = `<path d="M${x0} 70 v-14 q0-8 8-10 l30-4 q14-18 40-18 h${len - 130} q20 0 28 16 l${14} 4 q8 2 8 12 v14z" fill="#10222f" stroke="#10222f" stroke-width="2"/>`;
    for (let i = 0; i < 3; i++) wins += `<rect x="${x0 + 60 + i * ((len - 140) / 3)}" y="36" width="${(len - 140) / 3 - 6}" height="16" rx="3" fill="#7fb8dc"/>`;
    wins += `<rect x="${x0}" y="62" width="${len}" height="4" fill="#94bf33"/>`;
  } else {
    body = `<rect x="${x0}" y="24" width="${len}" height="60" rx="14" fill="#10222f" stroke="#10222f" stroke-width="2"/><rect x="${x0}" y="62" width="${len}" height="6" fill="#94bf33"/><rect x="${x0}" y="68" width="${len}" height="4" fill="#0078c0"/>`;
    for (let i = 0; i < n; i++) wins += `<rect x="${x0 + 44 + i * ww}" y="32" width="${ww - 8}" height="22" rx="4" fill="#3d6d8a" stroke="#6fb0d6" stroke-width="1.5"/>`;
    wins += `<path d="M${x0 + len - 4} 32 h-28 v26 h32z" fill="#3d6d8a" stroke="#6fb0d6" stroke-width="1.5"/>`;
  }
  const wheel = (x) => `<circle cx="${x}" cy="88" r="11" fill="#10222f"/><circle cx="${x}" cy="88" r="4.5" fill="#c7d3dc"/>`;
  return `<svg viewBox="0 0 320 110" role="img" aria-label="${esc(cat)} illustration" width="100%" style="max-width:300px">${body}${wins}${wheel(x0 + 44)}${wheel(x0 + len - 50)}<rect x="10" y="98" width="300" height="3" rx="2" fill="#cfdbe4"/></svg>`;
}

export function vehicleCard(v, { showRequest = true } = {}) {
  const pic = v.image ? `<img src="${esc(v.image)}" alt="${esc(v.name)}" loading="lazy">` : vehicleArt(v.category, v.capacity);
  return `<article class="card vehicle ${v.image ? 'has-img' : ''}" data-cat="${esc(v.category)}" data-cap="${v.capacity}"><div class="pic">${pic}</div><div class="body">
    <div><span class="tag">${esc(v.category)}</span></div><h3>${esc(v.name)}</h3>
    <div class="seats">Seats ${v.capacity}</div><p class="muted" style="margin:0;font-size:.93rem">${esc(v.description || '')}</p>
    <div class="pills">${(v.features || []).slice(0, 6).map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    ${showRequest ? `<div class="foot"><a class="btn btn-blue btn-sm" href="/book?vehicle=${v.id}">Get a quote</a></div>` : ''}</div></article>`;
}

export async function boot(active) {
  const c = await config();
  document.documentElement.lang = 'en';
  const nav = [['/', 'Home'], ['/fleet', 'Fleet'], ['/book', 'Request a Quote'], ['/about', 'About'], ['/contact', 'Contact'], ['/pay', 'Pay Invoice'], ['/driver', 'Drivers']];
  const tel = c.phone.replace(/[^+\d]/g, '');
  const st = openNow(c.hours);
  $('#hdr').innerHTML = `<div class="topbar"><div class="wrap"><span><span class="open-dot ${st.open ? 'on' : ''}"></span>${esc(st.text)}</span><span><a href="tel:${tel}">${esc(c.phone)}</a> &nbsp;·&nbsp; <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span></div></div>
  <header class="site"><div class="wrap"><a class="logo" href="/"><img src="/img/logo.png" alt="${esc(c.business_name)}" width="190" height="44"></a>
  <button class="burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
  <nav class="main" aria-label="Main">${nav.map(([h, t]) => `<a href="${h}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}<a class="btn btn-lime btn-sm" href="/book" style="margin-left:6px">Book now</a></nav></div></header>`;
  $('.burger').onclick = (e) => { const n = $('nav.main'); const o = n.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); };
  $('#ftr').innerHTML = `<footer class="site"><div class="wrap"><div class="cols">
    <div><span class="logo-w"><img src="/img/logo.png" alt="${esc(c.business_name)}"></span><p>Charter bus brokerage serving ${esc(c.service_area)}. Since 2016.</p><div class="socials">${socialLinks(c.socials)}</div></div>
    <div><h4>Company</h4><ul><li><a href="/about">About us</a></li><li><a href="/fleet">Our fleet</a></li><li><a href="/contact">Contact</a></li><li><a href="/terms">Terms &amp; conditions</a></li></ul></div>
    <div><h4>Customers</h4><ul><li><a href="/book">Request a quote</a></li><li><a href="/pay">Pay an invoice</a></li><li><a href="/driver">Driver portal</a></li></ul></div>
    <div><h4>Reach us</h4><ul><li><a href="tel:${tel}">${esc(c.phone)}</a></li><li><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>${c.address ? `<li>${esc(c.address)}</li>` : ''}<li>${c.hours.filter((h) => h.open).length ? 'Sun–Thu 10–7 · Fri 10–12:30' : ''}</li></ul></div>
  </div><div class="legal"><span>© ${new Date().getFullYear()} ${esc(c.business_name)}. All rights reserved.</span><span><a href="/terms">Terms</a> &nbsp;·&nbsp; <a href="/privacy">Privacy</a></span></div></div></footer>`;
  if (c.chesky) import('/js/chesky.js').then((m) => m.initChesky({ name: c.chesky_name, phone: c.phone })).catch(() => {});
  beacon();
  fillIcons();
  return c;
}

function chatWidget(c) {
  const sid = (() => { try { return sessionStorage.gabChat || (sessionStorage.gabChat = crypto.randomUUID()); } catch { return Math.random().toString(36).slice(2); } })();
  const box = document.createElement('div');
  box.innerHTML = `<button id="chesky-btn" aria-label="Chat with ${esc(c.chesky_name)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>Chat with ${esc(c.chesky_name)}</button>
  <div id="chesky" role="dialog" aria-label="Chat"><header><div><b>${esc(c.chesky_name)}</b><small>Virtual assistant · a person will confirm quotes</small></div><button aria-label="Close">×</button></header><div id="cmsgs" aria-live="polite"></div>
  <form id="cform"><input id="cin" placeholder="Type your question…" autocomplete="off" maxlength="1000" aria-label="Message"><button class="btn btn-blue btn-sm">Send</button></form></div>`;
  document.body.append(box);
  const panel = $('#chesky'), msgs = $('#cmsgs');
  const add = (t, who) => { const d = document.createElement('div'); d.className = 'm ' + who; d.textContent = t; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const open = (o) => { panel.classList.toggle('open', o); $('#chesky-btn').style.display = o ? 'none' : 'flex'; if (o && !msgs.children.length) add(`Hi, I'm ${c.chesky_name}. I can help you pick a vehicle, answer questions, or start a quote request. What are you planning?`, 'bot'); if (o) $('#cin').focus(); };
  $('#chesky-btn').onclick = () => open(true);
  $('#chesky header button').onclick = () => open(false);
  $('#cform').onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('#cin'), text = inp.value.trim(); if (!text) return;
    inp.value = ''; add(text, 'me'); const w = add('…', 'bot');
    try { const r = await api('/chat', { body: { session_id: sid, message: text } }); w.textContent = r.reply || 'Sorry, I did not catch that.'; } catch (err) { w.textContent = err.message; }
    msgs.scrollTop = msgs.scrollHeight;
  };
}
