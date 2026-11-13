// Editable website text. Elements in the public pages carry data-t="key"; whatever is written in the HTML is the default,
// and an override saved in Settings replaces it (on the server, so search engines see it too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting } from './db.js';
import { TRIPS } from './trips-content.js';
import { AREAS } from './areas-content.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const PAGE_FILES = { home: 'index.html', fleet: 'fleet.html', about: 'about.html', contact: 'contact.html', book: 'book.html', terms: 'terms.html', privacy: 'privacy.html' };
export const PAGE_LABELS = { home: 'Home page', fleet: 'Fleet page', about: 'About page', contact: 'Contact page', book: 'Request a quote page', terms: 'Terms and conditions', privacy: 'Privacy policy', footer: 'Footer (every page)', seo: 'Search results titles and descriptions', trips: 'Trip pages', areas: 'Area pages' };
const SIMPLE = (h) => String(h).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Keep the text safe: everything is escaped except a few formatting tags and plain links. */
export function sanitize(v) {
  let s = String(v ?? '').slice(0, 4000).replace(/&(?!(amp|lt|gt|quot|#39|nbsp);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  s = s.replace(/&lt;(\/?)(b|i|em|strong)&gt;/gi, '<$1$2>').replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;a href=&quot;(https?:\/\/[^\s"&<>]+|\/[^\s"&<>]*|tel:[+\d-]+|mailto:[^\s"&<>]+)&quot;&gt;/gi, '<a href="$1">').replace(/&lt;\/a&gt;/gi, '</a>');
  return s.replace(/\r?\n/g, '<br>');
}
export const plain = (v) => String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export const overrides = () => { try { const o = JSON.parse(getSetting('site_texts') || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

const EL = /<([a-z][a-z0-9]*)([^>]*?)\sdata-t="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g;
/** Default text of every tagged element in one page file. */
function scanPage(page) {
  let html = ''; try { html = fs.readFileSync(path.join(PUB, PAGE_FILES[page]), 'utf8'); } catch { return []; }
  const out = []; let m; EL.lastIndex = 0;
  while ((m = EL.exec(html))) out.push({ key: m[3], page, def: SIMPLE(m[5]) });
  return out;
}
const JS_KEYS = [
  ['footer.blurb', 'Charter bus broker for camps, shuls, yeshivos and families. In business since 2016.'], ['footer.h.company', 'Company'], ['footer.h.trips', 'Trips'], ['footer.h.customers', 'Customers'], ['footer.h.office', 'Office'],
];
const SEO_KEYS = [['home', 'Home page'], ['fleet', 'Fleet page'], ['about', 'About page'], ['contact', 'Contact page'], ['book', 'Request a quote page'], ['terms', 'Terms page'], ['privacy', 'Privacy page']];

/** Every editable item: [{ key, page, group, label, def }]. seo defaults are filled in by seo.js through setSeoDefaults. */
let seoDefaults = {};
export const setSeoDefaults = (o) => { seoDefaults = o; };
export function catalog() {
  const items = [];
  for (const p of Object.keys(PAGE_FILES)) for (const e of scanPage(p)) items.push({ ...e, group: p });
  for (const [k, d] of JS_KEYS) items.push({ key: k, page: 'footer', group: 'footer', def: d });
  for (const [p, label] of SEO_KEYS) for (const f of ['title', 'desc']) items.push({ key: `seo.${p}.${f}`, page: 'seo', group: 'seo', def: seoDefaults[`${p}.${f}`] || '', label: `${label}, ${f === 'title' ? 'page title' : 'description'}` });
  for (const t of TRIPS) for (const it of tripFlat('trips', t)) items.push({ ...it, page: 'trips', group: 'trips', label: `${t.name}: ${it.label}` });
  for (const a of AREAS) for (const it of tripFlat('areas', a)) items.push({ ...it, page: 'areas', group: 'areas', label: `${a.name}: ${it.label}` });
  return items;
}
/** Flat keys for a landing page object (trip or area). */
function tripFlat(kind, t) {
  const b = `${kind}.${t.slug}`, out = [{ key: `${b}.h1`, def: t.h1, label: 'Heading' }, { key: `${b}.lead`, def: t.lead, label: 'Intro' }];
  t.sections.forEach((s, i) => { out.push({ key: `${b}.s${i}.h`, def: s.h, label: `Section ${i + 1} heading` }); s.p.forEach((p, j) => out.push({ key: `${b}.s${i}.p${j}`, def: p, label: `Section ${i + 1} paragraph ${j + 1}` })); });
  t.faq.forEach((f, i) => { out.push({ key: `${b}.f${i}.q`, def: f.q, label: `Question ${i + 1}` }, { key: `${b}.f${i}.a`, def: f.a, label: `Answer ${i + 1}` }); });
  return out;
}
/** Apply overrides to a landing page object. */
export function applyLanding(kind, t) {
  const o = overrides(), b = `${kind}.${t.slug}`, g = (k, d) => (o[`${b}.${k}`] != null && o[`${b}.${k}`] !== '' ? plain(o[`${b}.${k}`]) : d);
  return { ...t, h1: g('h1', t.h1), lead: g('lead', t.lead), sections: t.sections.map((s, i) => ({ h: g(`s${i}.h`, s.h), p: s.p.map((p, j) => g(`s${i}.p${j}`, p)) })), faq: t.faq.map((f, i) => ({ q: g(`f${i}.q`, f.q), a: g(`f${i}.a`, f.a) })) };
}
/** Replace the inside of every data-t element that has an override. */
export function applyTexts(html) {
  const o = overrides(); if (!Object.keys(o).length) return html;
  return html.replace(EL, (all, tag, a, key, b, inner) => (o[key] != null && o[key] !== '' ? `<${tag}${a} data-t="${key}"${b}>${sanitize(o[key])}</${tag}>` : all));
}
export const seoText = (page, field, def) => { const v = overrides()[`seo.${page}.${field}`]; return v ? plain(v) : def; };

/** Admin: items with their current values. */
export function listTexts() {
  const o = overrides();
  const unent = (x) => String(x ?? '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return catalog().map((it) => ({ key: it.key, group: it.group, label: it.label || '', def: unent(it.def), value: o[it.key] ?? '' }));
}
export function saveTexts(map) {
  const valid = new Set(catalog().map((i) => i.key)), o = overrides();
  for (const [k, v] of Object.entries(map || {})) { if (!valid.has(k)) continue; const t = String(v ?? '').trim(); if (t) o[k] = t.slice(0, 4000); else delete o[k]; }
  setSetting('site_texts', JSON.stringify(o));
  return Object.keys(o).length;
}
/** Everything a visitor can read, as key to current text (used by Chesky). */
export function allContent() {
  const o = overrides(), out = {};
  for (const it of catalog()) out[it.key] = o[it.key] ? plain(o[it.key]) : plain(it.def);
  return out;
}
export const getText = (key, def = '') => { const v = overrides()[key]; return v ? plain(v) : def; };
/** Only the overrides, for client-side application to text drawn by scripts. */
export const publicOverrides = () => { const o = overrides(), out = {}; for (const [k, v] of Object.entries(o)) if (/^footer\./.test(k)) out[k] = sanitize(v); return out; };
