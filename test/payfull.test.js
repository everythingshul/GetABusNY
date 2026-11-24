// Pay in full (no deposit option), final drop-off everywhere, and no change list in revised quote emails.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
const port = 5400 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32), STRIPE_SECRET_KEY: 'sk_test_dummy' };
delete env.BREVO_API_KEY; delete env.RESEND_API_KEY; delete env.SMS_API_BASE;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
let cookie = '';
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
const emails = () => { const d = new DatabaseSync(path.join(dir, 't.db')); const rows = d.prepare('SELECT subject, html FROM outbox ORDER BY id').all(); d.close(); return rows; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const A = '/api/admin';
  const IT = [{ kind: 'pickup', address: '1 Start St' }, { kind: 'stop', address: '5 Middle Rd' }, { kind: 'dropoff', address: '22 Final Ave, Monsey, NY' }];

  // a request must have a final drop-off, and its email shows it
  let r = await call('POST', '/api/public/request', { name: 'No Drop', email: 'n@example.com', phone: '5550001', purpose: 'Trip', passengers: 10, depart_at: '2099-07-07T08:00', itinerary: [{ kind: 'pickup', address: '1 A St' }] });
  assert.equal(r.status, 400); assert.match(r.body.error, /final drop-off/i);
  r = await call('POST', '/api/public/request', { name: 'With Drop', email: 'w@example.com', phone: '5550002', purpose: 'Trip', passengers: 10, depart_at: '2099-07-07T08:00', itinerary: IT }); assert.equal(r.status, 200, JSON.stringify(r.body));
  let em = emails().find((e) => /We got your request/.test(e.subject)); assert.ok(em && /Final drop-off<\/div><div[^>]*>22 Final Ave/.test(em.html), 'the request email lists the final drop-off as a row');

  // quote: needs a final drop-off to be sent; the email and page show it; revised emails do not list changes
  const cust = (await call('POST', `${A}/customers`, { name: 'Pay Full', email: 'pf@example.com', phone: '5550003' })).body.id;
  const mk = async (it) => (await call('POST', `${A}/quotes`, { customer_id: cust, title: 'Q', items: [{ desc: 'Bus', qty: 1, unit_cents: 80000 }], tax_rate: 0, deposit_pct: 50, pay_full: 1, trip: { itinerary: it, depart_at: '2099-01-01T08:00' } })).body.id;
  const bad = await mk([{ kind: 'pickup', address: '1 A St' }, { kind: 'stop', address: '2 B St' }]);
  assert.equal((await call('POST', `${A}/quotes/${bad}/send`, { skip_sms: true })).status, 400, 'a quote cannot be sent without a final drop-off');
  const q = await mk(IT); assert.equal((await call('POST', `${A}/quotes/${q}/send`, { skip_sms: true })).status, 200);
  em = emails().filter((e) => /Quote Q-/.test(e.subject)).pop(); assert.match(em.html, /Final drop-off<\/div><div[^>]*>22 Final Ave/); assert.ok(!/Final drop-off:/.test(em.html), 'it is a regular itinerary row, not a separate line'); assert.match(em.html, /pay online/); assert.ok(!/deposit online/.test(em.html));
  await call('PUT', `${A}/quotes/${q}`, { title: 'Changed title', revision_note: 'price fix', items: [{ desc: 'Bus', qty: 1, unit_cents: 90000 }] });
  await call('POST', `${A}/quotes/${q}/send`, { skip_sms: true });
  em = emails().filter((e) => /Updated quote/.test(e.subject)).pop(); assert.ok(em, 'an updated quote email goes out'); assert.ok(!/What changed/i.test(em.html), 'the email does not describe what changed');
  const tok = (await call('GET', `${A}/quotes/${q}`)).body.token; const pubq = await (await fetch(`${base}/api/public/quote/${tok}`)).json();
  assert.equal(pubq.pay_full, true); assert.equal(pubq.deposit_cents, pubq.total_cents, 'the quote shows payment in full');

  // accept: the invoice is pay-in-full, with no deposit or partial options
  const acc = await fetch(`${base}/api/public/quote/${tok}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agree: true, name: 'Pay Full' }) });
  const sigNeeded = acc.status === 400; if (sigNeeded) await call('PUT', `${A}/quotes/${q}`, { sig_waived: 1 }); const acc2 = sigNeeded ? await fetch(`${base}/api/public/quote/${tok}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agree: true, name: 'Pay Full' }) }) : acc; assert.equal(acc2.status, 200);
  assert.ok(!(await acc2.json()).invoice_token, 'accepting does not send the invoice'); const draft = (await call('GET', `${A}/invoices`)).body.find((x) => x.quote_id === q); assert.equal(draft.status, 'draft'); await call('POST', `${A}/invoices/${draft.id}/send`, { skip_email: true }); const itok = draft.token; const inv = await (await fetch(`${base}/api/public/invoice/${itok}`)).json();
  assert.equal(inv.pay_full, true); assert.equal(inv.deposit_due_cents, 0, 'no deposit option'); assert.equal(inv.trip.final_dropoff, '22 Final Ave, Monsey, NY', 'the invoice page shows the final drop-off');
  const row = (await call('GET', `${A}/invoices`)).body.find((x) => x.number); assert.equal(row.deposit_cents, 0); assert.equal(row.pay_full, 1);
  const iid = (await call('GET', `${A}/invoices`)).body.find((x) => x.pay_full).id;
  assert.equal((await fetch(`${base}${A}/invoices/${iid}/pdf`, { headers: { cookie } })).status, 200);

  // the invoice email lists every stop and the button says View invoice
  await call('POST', `${A}/invoices/${draft.id}/send`, {}); const ie = emails().filter((e) => /Invoice INV|Invoice .* due/.test(e.subject) || /due$/.test(e.subject)).pop();
  assert.ok(ie, 'the invoice email went out'); assert.match(ie.html, /1 Start St/); assert.match(ie.html, /5 Middle Rd/); assert.match(ie.html, /22 Final Ave/); assert.match(ie.html, /View invoice/); assert.ok(!/Pay securely online/.test(ie.html));
  const pv = await (await fetch(`${base}/api/public/invoice/${itok}`)).json(); assert.equal(pv.trip.itinerary.length, 3, 'the invoice page gets every stop');
  // the address where the bus ends counts as the final drop-off
  const qe = await mk([...IT, { kind: 'end', address: '99 Garage Ln, Brooklyn, NY' }]); await call('POST', `${A}/quotes/${qe}/send`, { skip_sms: true });
  const ee = emails().filter((e) => /Quote Q-/.test(e.subject)).pop(); assert.match(ee.html, /Final drop-off<\/div><div[^>]*>99 Garage Ln/, 'a bus end is the final drop-off row'); assert.ok(!/Bus ends/i.test(ee.html), 'the bus own stops are not listed for the customer');
  const bq = await mk([{ kind: 'pickup', address: '1 A St' }, { kind: 'end', address: '5 Yard Rd' }]); assert.equal((await call('POST', `${A}/quotes/${bq}/send`, { skip_sms: true })).status, 200, 'a bus end alone satisfies the final drop-off requirement');
  // an invoice can be switched to pay in full, which clears its deposit
  await call('PUT', `${A}/invoices/${iid}`, { pay_full: 0, deposit_cents: 20000 }); assert.equal((await (await fetch(`${base}/api/public/invoice/${itok}`)).json()).deposit_due_cents, 20000);
  await call('PUT', `${A}/invoices/${iid}`, { pay_full: 1, deposit_cents: 20000 }); assert.equal((await (await fetch(`${base}/api/public/invoice/${itok}`)).json()).deposit_due_cents, 0, 'pay in full removes the deposit');
  console.log('Pay in full and final drop-off checks passed.');
} finally { srv.kill(); }
