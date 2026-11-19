// Ledger (all money in and out), invoice PDFs, attachments, and taking a one-off payment.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'led-'));
const port = 4900 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', BASE_URL: base, SESSION_SECRET: 'x'.repeat(32) };
delete env.SMS_API_BASE; delete env.SMS_API_KEY; delete env.BREVO_API_KEY; delete env.RESEND_API_KEY; delete env.STRIPE_SECRET_KEY;
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const call = async (method, p, body, headers = {}) => {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(base + p, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body == null ? undefined : raw ? body : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || ''; return { status: r.status, ct, body: ct.includes('json') ? await r.json().catch(() => ({})) : Buffer.from(await r.arrayBuffer()) };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
try {
  await sleep(4500);
  assert.equal((await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' })).status, 200);
  const A = '/api/admin';

  // ---- take a payment that is not part of a trip: in person
  let r = await call('POST', `${A}/payments/quick`, { name: 'Walk In', phone: '5551112222', amount_cents: 25000, description: 'Deposit for a future trip', mode: 'received', method: 'check', reference: 'Check 118' });
  assert.equal(r.status, 200); assert.equal(r.body.paid, true); assert.match(r.body.number, /^INV-\d{6}$/);
  const inv1 = r.body.invoice_id;
  assert.equal((await call('POST', `${A}/payments/quick`, { name: 'X', amount_cents: 50, mode: 'received' })).status, 400, 'too small');
  assert.equal((await call('POST', `${A}/payments/quick`, { amount_cents: 5000, mode: 'link' })).status, 400, 'needs a customer');
  assert.equal((await call('POST', `${A}/payments/quick`, { name: 'No Contact', amount_cents: 5000, mode: 'link' })).status, 400, 'a link needs somewhere to go');
  // ---- take a payment by link (card online)
  r = await call('POST', `${A}/payments/quick`, { name: 'Link Person', email: 'link@example.com', amount_cents: 12000, description: 'Charter balance', mode: 'link', send_email: true });
  assert.equal(r.status, 200); assert.ok(r.body.url.includes('/pay/')); const tok = r.body.url.split('/pay/')[1];
  const pub = await call('GET', `/api/public/invoice/${tok}`); assert.equal(pub.status, 200); assert.equal(pub.body.balance_cents, 12000); assert.equal(pub.body.trip, null);
  assert.equal(pub.body.items[0].desc, 'Charter balance');
  const inv2 = r.body.invoice_id;

  // ---- the ledger mirrors payments, with the invoice attached
  r = await call('GET', `${A}/ledger?from=all&to=all`); assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 1); const e = r.body.rows[0];
  assert.equal(e.direction, 'in'); assert.equal(e.signed_cents, 25000); assert.equal(e.vendor, 'Walk In'); assert.equal(e.invoice_ref, r.body.rows[0].invoice_ref); assert.match(e.invoice_ref, /^INV-/);
  assert.equal(e.paid_with, 'Check'); assert.equal(e.invoice_id, inv1); assert.equal(e.auto, true); assert.match(e.notes, /Check 118/);
  assert.equal(r.body.totals.money_in, 25000); assert.equal(r.body.totals.money_out, 0); assert.equal(r.body.totals.net, 25000);
  // syncing again does not duplicate
  assert.equal((await call('GET', `${A}/ledger?from=all&to=all`)).body.rows.length, 1);
  // the invoice attached to it is a real PDF
  const pdf = await call('GET', `${A}/invoices/${inv1}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.ct, 'application/pdf'); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  // payment entries are locked, but account, notes and category can be set
  assert.equal((await call('PUT', `${A}/ledger/${e.id}`, { amount_cents: 1 })).status, 200); assert.equal((await call('GET', `${A}/ledger?from=all`)).body.rows[0].amount_cents, 25000, 'amount of an invoice payment cannot be changed');
  r = await call('PUT', `${A}/ledger/${e.id}`, { account: 'Business checking', notes: 'Deposited Monday' }); assert.equal(r.body.account, 'Business checking');
  assert.equal((await call('DELETE', `${A}/ledger/${e.id}`)).status, 400, 'cannot delete an invoice payment');

  // ---- refund shows up as money out
  const pay = (await call('GET', `${A}/invoices/${inv1}/payments`)).body[0];
  r = await call('POST', `${A}/payments/${pay.id}/refund`, { amount_cents: 5000, note: 'Partial refund' }); assert.equal(r.status, 200);
  r = await call('GET', `${A}/ledger?from=all`); assert.equal(r.body.totals.money_in, 25000); assert.equal(r.body.totals.money_out, 5000); assert.equal(r.body.totals.net, 20000);
  assert.ok(r.body.rows.some((x) => x.direction === 'out' && x.category === 'Refunds' && x.amount_cents === 5000));

  // ---- manual entries: money out with a receipt, money in
  r = await call('POST', `${A}/ledger`, { date: '2026-03-05', direction: 'out', amount_cents: 18250, vendor: 'Sunoco', invoice_ref: 'S-4471', description: 'Diesel for the coach', paid_with: 'Credit card', account: 'Business credit card', category: 'Fuel', notes: 'Fill up before camp run' });
  assert.equal(r.status, 200); const man = r.body.id; assert.equal(r.body.src, null);
  assert.equal((await call('POST', `${A}/ledger`, { direction: 'out', amount_cents: 0 })).status, 400); assert.equal((await call('POST', `${A}/ledger`, { direction: 'sideways', amount_cents: 100 })).status, 400);
  r = await call('POST', `${A}/ledger/${man}/file`, PDF, { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('Sunoco receipt.pdf') }); assert.equal(r.status, 200);
  r = await call('GET', `${A}/ledger/${man}/file`); assert.equal(r.status, 200); assert.equal(r.ct.split(';')[0], 'application/pdf'); assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('POST', `${A}/ledger/${man}/file`, Buffer.from('not a real file at all, just text'), { 'content-type': 'application/pdf' })).status, 400, 'content is checked, not just the label');
  r = await call('GET', `${A}/ledger?from=2026-03-01&to=2026-03-31`); assert.equal(r.body.rows.length, 1); assert.equal(r.body.rows[0].has_file, true); assert.equal(r.body.rows[0].file_name, 'Sunoco receipt.pdf'); assert.equal(r.body.rows[0].signed_cents, -18250);
  r = await call('PUT', `${A}/ledger/${man}`, { amount_cents: 19000, vendor: 'Sunoco Mobil' }); assert.equal(r.body.amount_cents, 19000);
  r = await call('GET', `${A}/ledger?from=all&direction=out&category=Fuel`); assert.equal(r.body.rows.length, 1); r = await call('GET', `${A}/ledger?from=all&q=Sunoco`); assert.equal(r.body.rows.length, 1);
  r = await call('GET', `${A}/ledger?from=all`); assert.equal(r.body.totals.entries, 3); assert.equal(r.body.totals.money_out, 5000 + 19000);
  assert.ok(r.body.balances.some((b) => b.k === 'Business checking'));

  // ---- maaser is a fixed ten percent of money in; marking it given records a charity expense
  r = await call('POST', `${A}/ledger`, { date: '2026-03-06', direction: 'in', amount_cents: 100000, vendor: 'Cash job', description: 'Cash deposit' }); assert.equal(r.body.maaser_cents, 10000); assert.equal(r.body.maaser_given, 0);
  const inc = r.body.id;
  r = await call('GET', `${A}/ledger?from=all`); assert.equal(r.body.totals.maaser, 2500 + 10000, 'ten percent of the $250 invoice payment plus the $1,000 cash job'); assert.equal(r.body.totals.maaser_owed, 12500); assert.equal(r.body.totals.maaser_given, 0);
  assert.equal((await call('PUT', `${A}/ledger/${inc}`, { maaser_cents: 1 })).body.maaser_cents, 10000, 'the percentage is fixed');
  const before = (await call('GET', `${A}/ledger?from=all`)).body.totals.money_out;
  r = await call('PUT', `${A}/ledger/${inc}/maaser`, { given: true }); assert.equal(r.status, 200); assert.equal(r.body.maaser_given, 1);
  r = await call('GET', `${A}/ledger?from=all`); const ch = r.body.rows.find((x) => x.category === 'Maaser'); assert.ok(ch, 'a charity expense was recorded'); assert.equal(ch.direction, 'out'); assert.equal(ch.amount_cents, 10000); assert.match(ch.description, /Maaser on Cash deposit/);
  assert.equal(r.body.totals.money_out, before + 10000); assert.equal(r.body.totals.maaser_given, 10000); assert.equal(r.body.totals.maaser_owed, 2500);
  assert.equal((await call('PUT', `${A}/ledger/${inc}/maaser`, { given: true })).status, 200); assert.equal((await call('GET', `${A}/ledger?from=all`)).body.rows.filter((x) => x.category === 'Maaser').length, 1, 'ticking twice does not record it twice');
  r = await call('PUT', `${A}/ledger/${inc}`, { amount_cents: 200000 }); assert.equal(r.body.maaser_cents, 20000); assert.equal((await call('GET', `${A}/ledger?from=all`)).body.rows.find((x) => x.category === 'Maaser').amount_cents, 20000, 'the charity expense follows the amount');
  r = await call('PUT', `${A}/ledger/${inc}/maaser`, { given: false }); assert.equal(r.body.maaser_given, 0); assert.equal((await call('GET', `${A}/ledger?from=all`)).body.rows.filter((x) => x.category === 'Maaser').length, 0, 'unticking removes the expense');
  await call('PUT', `${A}/ledger/${inc}/maaser`, { given: true }); const exp = (await call('GET', `${A}/ledger?from=all`)).body.rows.find((x) => x.category === 'Maaser');
  assert.equal((await call('DELETE', `${A}/ledger/${exp.id}`)).status, 200); assert.equal((await call('GET', `${A}/ledger?from=all`)).body.rows.find((x) => x.id === inc).maaser_given, 0, 'deleting the expense puts the maaser back to not given');
  assert.equal((await call('PUT', `${A}/ledger/${man}/maaser`, { given: true })).status, 400, 'money out has no maaser');
  r = await call('POST', `${A}/ledger`, { date: '2026-03-07', direction: 'in', amount_cents: 50000, vendor: 'Already gave', maaser_given: true }); assert.equal(r.body.maaser_given, 1);
  assert.equal((await call('GET', `${A}/ledger?from=all&q=Already`)).body.rows.length, 1);
  r = await call('DELETE', `${A}/ledger/${man}/file`); assert.equal(r.status, 200); assert.equal((await call('GET', `${A}/ledger/${man}/file`)).status, 404);
  assert.equal((await call('DELETE', `${A}/ledger/${man}`)).status, 200);

  // ---- export has the columns of your sheet
  r = await call('GET', `${A}/export/ledger`); assert.equal(r.status, 200); assert.ok(r.body.length > 500);
  // ---- admin only
  cookie = ''; assert.equal((await call('GET', `${A}/ledger`)).status, 401); assert.equal((await call('POST', `${A}/payments/quick`, { name: 'x', amount_cents: 500 })).status, 401);
  console.log('Ledger checks passed.');
} finally { srv.kill(); }
