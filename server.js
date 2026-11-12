import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './src/db.js';
import { seedAdmin } from './src/auth.js';
import { pub, stripeWebhook } from './src/routes/public.js';
import { driver } from './src/routes/driver.js';
import { admin } from './src/routes/admin.js';
import { runFollowups, inQuietWindow } from './src/services.js';
import { chatPublicRouter } from './src/chesky.js';
import { registerPublicBanner } from './src/banner.js';
import { staffCalendar, driverCalendar } from './src/extras.js';
import { one, run, getSetting } from './src/db.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dir, 'public');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/d/') || req.path.startsWith('/api/driver') || req.path.startsWith('/admin') || req.path.startsWith('/pay/') || req.path.startsWith('/quote/') || req.path.startsWith('/contract/') || req.path.startsWith('/cal/')) res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/d/') || req.path.startsWith('/quote/') || req.path.startsWith('/pay/') || req.path.startsWith('/contract/')) res.setHeader('Referrer-Policy', 'no-referrer'); // tokens live in the URL
  next();
});

// Stripe needs the raw body for signature verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);
app.use(express.json({ limit: '200kb' }));

registerPublicBanner(app);
app.use('/api/public/chesky', chatPublicRouter());
app.use('/api/public', pub);
app.use('/api/driver', driver);
app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('/healthz', (req, res) => { one('SELECT 1 x'); res.json({ ok: true }); });
// Calendar subscriptions (add by URL in Google Calendar / Apple Calendar / Outlook)
app.get('/cal/driver/:token.ics', (req, res) => { const d = one('SELECT * FROM drivers WHERE token=? AND active=1', req.params.token); if (!d) return res.status(404).end(); res.type('text/calendar; charset=utf-8').send(driverCalendar(d)); });
app.get('/cal/:token.ics', (req, res) => { if (req.params.token !== getSetting('cal_token')) return res.status(404).end(); res.type('text/calendar; charset=utf-8').send(staffCalendar()); });
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), { maxAge: '7d' }));
app.use(express.static(PUB, { extensions: ['html'], maxAge: '1h' }));

const page = (f) => (req, res) => res.sendFile(path.join(PUB, f));
// Vehicle page with Open Graph tags, so WhatsApp, texts and email show a proper link preview
app.get('/bus/:id', (req, res) => {
  const v = one('SELECT id,name,category,capacity,description,image FROM vehicles WHERE id=? AND active=1', req.params.id);
  let html; try { html = fs.readFileSync(path.join(PUB, 'bus.html'), 'utf8'); } catch { return res.status(404).sendFile(path.join(PUB, '404.html')); }
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = v ? `${v.name}, seats ${v.capacity} | ${getSetting('business_name')}` : getSetting('business_name');
  const desc = v ? `${v.category}. ${v.description || ''} Request a quote from ${getSetting('business_name')}.`.trim() : '';
  const img = v?.image ? (v.image.startsWith('http') ? v.image : base + v.image) : `${base}/img/logo.png`;
  const tags = `<meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(`${base}/bus/${req.params.id}`)}"><meta property="og:image" content="${e(img)}"><meta name="twitter:card" content="summary_large_image">`;
  res.status(v ? 200 : 404).type('html').send(html.replace('<!--OG-->', tags).replace(/<title>[^<]*<\/title>/, `<title>${e(title)}</title>`));
});
app.get('/admin', page('admin/index.html'));
app.get('/driver', page('driver.html'));
app.get('/d/:token', page('driver.html'));
app.get('/quote/:token', page('quote.html'));
app.get('/contract/:token', page('contract.html'));
app.get('/pay/:token', page('pay.html'));
app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Server error' }); });

seedAdmin();
setInterval(() => runFollowups().catch((e) => console.error('followups', e)), 60000).unref();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Get A Bus NY running on http://localhost:${port}`));
