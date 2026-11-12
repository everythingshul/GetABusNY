import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { one, insert, now, all } from './db.js';

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), '.session_secret');
  try { return fs.readFileSync(f, 'utf8'); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = secret();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
export function makeSession(uid) {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 14 * 86400000 })).toString('base64url');
  return `${p}.${sign(p)}`;
}
function readSession(val) {
  const [p, s] = String(val || '').split('.');
  if (!p || !s || sign(p) !== s) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
export const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0]));

export function requireAdmin(req, res, next) {
  const s = readSession(cookies(req).gab_admin);
  const u = s && one('SELECT id,email,name,role FROM users WHERE id=?', s.uid);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  // CSRF defense: state-changing requests must be JSON or a same-origin upload
  if (!['GET', 'HEAD'].includes(req.method)) {
    const ct = req.headers['content-type'] || '';
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' });
    if (!ct.includes('application/json') && !ct.startsWith('image/') && req.method !== 'DELETE' && !(req.headers['content-length'] === '0')) return res.status(415).json({ error: 'JSON required' });
  }
  req.user = u;
  next();
}

export function seedAdmin() {
  if (one('SELECT 1 x FROM users LIMIT 1')) return;
  const email = process.env.ADMIN_EMAIL || 'admin@getabusny.com';
  let pw = process.env.ADMIN_PASSWORD;
  const generated = !pw;
  if (!pw) pw = crypto.randomBytes(9).toString('base64url');
  insert('users', { email, name: 'Admin', pass_hash: hashPassword(pw), role: 'admin', created_at: now() });
  console.log(generated ? `\n  First-run admin created:\n    email:    ${email}\n    password: ${pw}   (generated — change it in Settings)\n` : `\n  First-run admin created for ${email} (password from ADMIN_PASSWORD)\n`);
}

// tiny in-memory rate limiter
const hits = new Map();
export const limit = (name, max, windowMs) => (req, res, next) => {
  const key = `${name}:${req.ip}`;
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  arr.push(t); hits.set(key, arr);
  next();
};
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600000)) hits.delete(k); }, 600000).unref();
