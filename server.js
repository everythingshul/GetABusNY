import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './src/db.js';
import { seedAdmin } from './src/auth.js';
import { pub, stripeWebhook } from './src/routes/public.js';
import { driver } from './src/routes/driver.js';
import { admin } from './src/routes/admin.js';
import { runFollowups, inQuietWindow } from './src/services.js';
import { chatPublicRouter } from './src/chesky.js';
import { staffCalendar, driverCalendar } from './src/extras.js';
import { one, run, getSetting } from './src/db.js';
import crypto from 'node:crypto';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dir, 'public');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/d/') || req.path.startsWith('/api/driver') || req.path.startsWith('/admin') || req.path.startsWith('/pay/') || req.path.startsWith('/quote/') || req.path.startsWith('/v/') || req.path.startsWith('/contract/') || req.path.startsWith('/cal/')) res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/d/') || req.path.startsWith('/v/') || req.path.startsWith('/quote/') || req.path.startsWith('/pay/') || req.path.startsWith('/contract/')) res.setHeader('Referrer-Policy', 'no-referrer'); // tokens live in the URL
  next();
});

// Stripe needs the raw body for signature verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);
app.use(express.json({ limit: '200kb' }));

// Twilio inbound texts (STOP / START). Validates X-Twilio-Signature when TWILIO_TOKEN is set.
app.post('/api/twilio/sms', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
  const tok = process.env.TWILIO_TOKEN;
  if (tok) {
    const url = `${(process.env.BASE_URL || '').replace(/\/$/, '')}/api/twilio/sms`;
    const data = url + Object.keys(req.body).sort().map((k) => k + req.body[k]).join('');
    const sig = crypto.createHmac('sha1', tok).update(data).digest('base64');
    if (sig !== req.headers['x-twilio-signature']) return res.status(403).end();
  }
  const word = String(req.body.Body || '').trim().toUpperCase();
  const from = String(req.body.From || '');
  const digits = from.replace(/\D/g, '').slice(-10);
  let reply = '';
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) { run("UPDATE customers SET sms_optin=0 WHERE replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')','') LIKE ?", `%${digits}`); reply = 'You are unsubscribed and will not get more texts from us.'; }
  else if (['START', 'YES', 'UNSTOP'].includes(word)) { run("UPDATE customers SET sms_optin=1, sms_optin_at=? WHERE replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')','') LIKE ?", new Date().toISOString(), `%${digits}`); reply = 'You are subscribed to trip updates. Reply STOP anytime to opt out.'; }
  else if (word === 'HELP') reply = `${getSetting('business_name')}: call ${getSetting('phone')}. Reply STOP to opt out.`;
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${reply}</Message>` : ''}</Response>`);
});

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
app.get('/admin', page('admin/index.html'));
app.get('/driver', page('driver.html'));
app.get('/d/:token', page('driver.html'));
app.get('/v/:token', page('vendor.html'));
app.get('/quote/:token', page('quote.html'));
app.get('/contract/:token', page('contract.html'));
app.get('/pay/:token', page('pay.html'));
app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Server error' }); });

seedAdmin();
setInterval(() => runFollowups().catch((e) => console.error('followups', e)), 60000).unref();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Get A Bus NY running on http://localhost:${port}`));
