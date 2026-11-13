// Internal-only data, "do not email" options and writing a text from Messages.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'int-'));
const port = 4600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.SMS_API_BASE; delete env.SMS_API_KEY; delete env.BREVO_API_KEY; delete env.RESEND_API_KEY;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
try {
  await sleep(4500);
  assert.equal((await api('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' })).status, 200);

  // vehicles: internal link, pricing and notes never reach the public
  const v = (await api('GET', '/api/admin/vehicles')).body[0];
  let r = await api('PUT', `/api/admin/vehicles/${v.id}`, { operator_url: 'https://operator.example.com/bus/12', internal_pricing: 'cost 150/hr, we charge 195/hr', internal_notes: 'ask for Moshe' });
  assert.equal(r.status, 200); assert.equal(r.body.operator_url, 'https://operator.example.com/bus/12'); assert.equal(r.body.internal_pricing, 'cost 150/hr, we charge 195/hr');
  r = await api('PUT', `/api/admin/vehicles/${v.id}`, { operator_url: 'javascript:alert(1)' }); assert.equal(r.body.operator_url, null, 'only http and https links are kept');
  await api('PUT', `/api/admin/vehicles/${v.id}`, { operator_url: 'https://operator.example.com/bus/12' });
  for (const p of ['/api/public/fleet', `/api/public/vehicle/${v.id}`, `/bus/${v.id}`, '/sitemap.xml', '/']) {
    const t = await (await fetch(base + p)).text();
    for (const secret of ['operator.example.com', 'we charge 195', 'ask for Moshe', 'internal_pricing', 'operator_url']) assert.ok(!t.includes(secret), `${secret} leaked on ${p}`);
  }

  // leads: notes typed by staff are internal and stay out of the quote and operator emails
  r = await api('POST', '/api/admin/requests/manual', { name: 'Walk In', phone: '5557654321', email: 'walk@example.com', purpose: 'Camp trip', passengers: 20, depart_at: '2099-07-01T08:00', itinerary: [{ kind: 'pickup', address: '1 A St' }, { kind: 'dropoff', address: '2 B St' }], internal_notes: 'Rude on the phone, get deposit first', comments: 'should be ignored' });
  assert.equal(r.status, 200);
  const lead = (await api('GET', '/api/admin/requests')).body.find((x) => x.name === 'Walk In');
  assert.equal(lead.notes, 'Rude on the phone, get deposit first'); assert.ok(!(JSON.parse(lead.details).comments || '').includes('Rude'));
  r = await api('POST', '/api/public/request', { name: 'Web Person', email: 'web@example.com', phone: '5550001111', purpose: 'Camp trip', passengers: 10, depart_at: '2099-07-02T08:00', itinerary: [{ kind: 'pickup', address: '3 C St' }, { kind: 'dropoff', address: '4 D St' }], internal_notes: 'visitor tries to set internal notes' });
  assert.equal(r.status, 200); assert.equal((await api('GET', '/api/admin/requests')).body.find((x) => x.name === 'Web Person').notes, null, 'website visitors cannot write internal notes');

  // quotes: skip the email and the text, still marked sent
  const outbox = async () => (await api('GET', '/api/admin/messages-sent?type=email&q=walk@example.com')).body.length; // emails to the customer only (staff alerts go elsewhere)
  const q = (await api('POST', `/api/admin/requests/${lead.id}/quote`)).body.quote_id;
  await api('PUT', `/api/admin/quotes/${q}`, { items: [{ desc: 'Coach', qty: 1, unit_cents: 100000 }] });
  const before = await outbox();
  r = await api('POST', `/api/admin/quotes/${q}/send`, { skip_email: true, skip_sms: true }); assert.equal(r.status, 200);
  assert.equal(await outbox(), before, 'no email was sent'); assert.equal((await api('GET', `/api/admin/quotes/${q}`)).body.status, 'sent');
  const inv = (await api('POST', '/api/admin/invoices', { customer_id: lead.customer_id, title: 'T', items: [{ desc: 'x', qty: 1, unit_cents: 5000 }] })).body.id;
  r = await api('POST', `/api/admin/invoices/${inv}/send`, { skip_email: true }); assert.equal(r.status, 200); assert.equal(await outbox(), before, 'invoice was not emailed');
  r = await api('POST', `/api/admin/invoices/${inv}/payments`, { amount_cents: 5000, method: 'cash', skip_email: true, skip_sms: true }); assert.equal(r.status, 200); assert.equal(await outbox(), before, 'receipt was not emailed');
  const q2 = (await api('POST', `/api/admin/requests/${lead.id}/quote`)).body.quote_id;
  await api('PUT', `/api/admin/quotes/${q2}`, { items: [{ desc: 'Coach', qty: 1, unit_cents: 100000 }] });
  await api('POST', `/api/admin/quotes/${q2}/send`, {}); assert.ok(await outbox() > before, 'without the box ticked it still emails');

  // writing a text from Messages
  r = await api('POST', '/api/admin/messages/text', { to: '5557654321', message: 'Hi' }); assert.equal(r.status, 400); assert.match(r.body.error, /not set up/);
  r = await api('POST', '/api/admin/messages/text', { to: '5557654321', message: '' }); assert.equal(r.status, 400);
  console.log('Internal checks passed.');
} finally { srv.kill(); }
