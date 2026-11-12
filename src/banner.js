// Home page banner slideshow. Images live outside the public folder and are only served to the page itself,
// with short-lived signed links. A determined person can still screenshot; this stops direct links, right click saving and sharing the URL.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, one, insert, update, run, now, getSetting, log } from './db.js';
import { hmac } from './auth.js';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'banner');
const TTL = 10 * 60; // seconds a signed link works
const sig = (id, exp) => hmac(`banner:${id}:${exp}`).slice(0, 22);
const kind = (b) => (b.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ? ['jpg', 'image/jpeg'] : b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? ['png', 'image/png'] : b.subarray(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null);

export function bannerList() {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  return { seconds: Math.min(Math.max(Number(getSetting('banner_seconds')) || 6, 3), 30), slides: all('SELECT id FROM banner_images WHERE active=1 ORDER BY sort, id').map((r) => ({ id: r.id, url: `/banner/${r.id}.jpg?e=${exp}&s=${sig(r.id, exp)}` })) };
}

export function registerPublicBanner(app) {
  app.get('/api/public/banner', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(bannerList()); });
  app.get('/banner/:id.jpg', (req, res) => {
    const id = Number(req.params.id), exp = Number(req.query.e), s = String(req.query.s || '');
    const deny = () => res.status(404).type('text/plain').send('Not found');
    if (!id || !exp || exp < Date.now() / 1000 || s.length !== 22 || !crypto.timingSafeEqual(Buffer.from(sig(id, exp)), Buffer.from(s))) return deny();
    // opened directly in a tab, framed, or requested from another site: refuse
    const dest = req.headers['sec-fetch-dest'], site = req.headers['sec-fetch-site'];
    if (dest && !['empty', 'image'].includes(dest)) return deny();
    if (site && !['same-origin', 'same-site'].includes(site)) return deny();
    const row = one('SELECT * FROM banner_images WHERE id=? AND active=1', id);
    const f = row && path.join(DIR, path.basename(row.file));
    if (!f || !fs.existsSync(f)) return deny();
    res.setHeader('Content-Type', row.mime); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, noimageindex'); res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.send(fs.readFileSync(f));
  });
}

export function bannerAdminRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const bad = (m, status = 400) => Object.assign(new Error(m), { status });
  r.get('/', wrap(() => ({ seconds: Number(getSetting('banner_seconds')) || 6, images: all('SELECT id, name, sort, active, created_at FROM banner_images ORDER BY sort, id') })));
  r.post('/', express.raw({ type: 'image/*', limit: '12mb' }), wrap((req) => {
    const b = req.body; if (!Buffer.isBuffer(b) || b.length < 100) throw bad('No image received');
    const k = kind(b); if (!k) throw bad('Use a JPG, PNG or WEBP image');
    fs.mkdirSync(DIR, { recursive: true });
    const file = `${crypto.randomBytes(10).toString('hex')}.${k[0]}`; fs.writeFileSync(path.join(DIR, file), b);
    const max = one('SELECT COALESCE(MAX(sort),0) m FROM banner_images').m;
    const id = insert('banner_images', { file, mime: k[1], name: String(req.headers['x-file-name'] || '').slice(0, 120) || file, sort: max + 10, active: 1, created_at: now() });
    log(req.user.email, 'banner.added', 'banner', id); return { id };
  }));
  r.put('/order', wrap((req) => { (Array.isArray(req.body?.ids) ? req.body.ids : []).forEach((id, i) => update('banner_images', Number(id), { sort: (i + 1) * 10 })); return { ok: true }; }));
  r.put('/settings', wrap((req) => { const s = Math.round(Number(req.body?.seconds)); if (!(s >= 3 && s <= 30)) throw bad('Seconds per image must be between 3 and 30'); run("INSERT INTO settings(key,value) VALUES('banner_seconds',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(s)); return { ok: true }; }));
  r.put('/:id', wrap((req) => { update('banner_images', Number(req.params.id), { active: req.body?.active ? 1 : 0 }); return { ok: true }; }));
  r.delete('/:id', wrap((req) => { const row = one('SELECT * FROM banner_images WHERE id=?', req.params.id); if (!row) throw bad('Not found', 404); try { fs.unlinkSync(path.join(DIR, path.basename(row.file))); } catch {} run('DELETE FROM banner_images WHERE id=?', row.id); log(req.user.email, 'banner.removed', 'banner', row.id); return { ok: true }; }));
  r.get('/:id/preview', (req, res) => { const row = one('SELECT * FROM banner_images WHERE id=?', req.params.id); const f = row && path.join(DIR, path.basename(row.file)); if (!f || !fs.existsSync(f)) return res.status(404).end(); res.setHeader('Content-Type', row.mime); res.setHeader('Cache-Control', 'private, max-age=60'); res.send(fs.readFileSync(f)); });
  return r;
}
