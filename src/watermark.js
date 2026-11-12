// Puts the logo on every photo the public site serves, so a saved copy always carries it.
// The stored original is never changed; the marked copy is built once and cached on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const LOGO = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'img', 'logo.png');
const CACHE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'wm-cache');
export const MARKABLE = /\.(jpe?g|png|webp)$/i;

let logoBuf = null;
const logo = () => (logoBuf ||= fs.readFileSync(LOGO));

/** Marked copy of an image buffer. Falls back to the original bytes if the image cannot be processed. */
export async function mark(buf, ext) {
  try {
    const base = sharp(buf, { failOn: 'none' }).rotate();
    const meta = await base.metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (!w || !h) return buf;
    const rot = (meta.orientation || 1) >= 5; const W = rot ? h : w, H = rot ? w : h;
    const lw = Math.max(90, Math.round(W * 0.2)), pad = Math.max(6, Math.round(lw * 0.07));
    const lg = await sharp(logo()).resize({ width: lw - pad * 2 }).png().toBuffer();
    const lm = await sharp(lg).metadata();
    const pw = lm.width + pad * 2, ph = lm.height + pad * 2;
    const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="${Math.round(pad * 1.2)}" fill="#ffffff" fill-opacity="0.82"/></svg>`);
    const margin = Math.max(8, Math.round(W * 0.025));
    const out = base.composite([{ input: plate, left: Math.max(0, W - pw - margin), top: Math.max(0, H - ph - margin) }, { input: lg, left: Math.max(0, W - pw - margin + pad), top: Math.max(0, H - ph - margin + pad) }]);
    const e = ext.toLowerCase().replace('.', '');
    return await (e === 'png' ? out.png() : e === 'webp' ? out.webp({ quality: 86 }) : out.jpeg({ quality: 86, mozjpeg: true })).toBuffer();
  } catch { return buf; }
}

/** Marked copy of an image file, cached by file identity so each photo is processed once. */
export async function markedFile(file) {
  const st = fs.statSync(file), ext = path.extname(file);
  const key = crypto.createHash('sha1').update(`${file}|${st.mtimeMs}|${st.size}|${fs.statSync(LOGO).mtimeMs}`).digest('hex');
  const cached = path.join(CACHE, key + ext.toLowerCase());
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const out = await mark(fs.readFileSync(file), ext);
  try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cached, out); } catch { /* cache is optional */ }
  return out;
}
