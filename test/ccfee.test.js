// Card processing fee on invoices, and staff signature overrides.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';

// ---- in-process: fee math, recording and the ledger
const d0 = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf0-'));
Object.assign(process.env, { DB_PATH: path.join(d0, 't.db'), DATA_DIR: d0, UPLOAD_DIR: d0, ADMIN_EMAIL: 't@t.com', ADMIN_PASSWORD: 'testpassword123', SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://localhost:1' });
delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.SMS_API_BASE;
const D = await import('../src/db.js'); const S = await import('../src/services.js'); const L = await import('../src/ledger.js');
assert.equal(D.cardFee({ cc_fee_on: 0, cc_fee_pct: 3, cc_fee_flat_cents: 30 }, 100000), 0, 'off means no fee');
assert.equal(D.cardFee({ cc_fee_on: 1, cc_fee_pct: 3, cc_fee_flat_cents: 30 }, 100000), 3030);
assert.equal(D.cardFee({ cc_fee_on: 1, cc_fee_pct: 2.9, cc_fee_flat_cents: 0 }, 12345), 358);
assert.equal(D.cardFee({ cc_fee_on: 1, cc_fee_pct: 0, cc_fee_flat_cents: 0 }, 5000), 0);
assert.match(D.cardFeeText({ cc_fee_pct: 3, cc_fee_flat_cents: 30 }, (c) => `$${(c / 100).toFixed(2)}`), /3% \+ \$0\.30.*no fee to pay by check, cash, Zelle/);
const cid = D.insert('customers', { name: 'Fee Payer', email: 'f@example.com', created_at: D.now(), updated_at: D.now() });
const iid = D.insert('invoices', { number: 'INV-F1', customer_id: cid, status: 'sent', items: JSON.stringify([{ desc: 'Bus', qty: 1, unit_cents: 100000 }]), token: 'tk1', cc_fee_on: 1, cc_fee_pct: 3, cc_fee_flat_cents: 30, created_at: D.now(), updated_at: D.now() });
S.recalcInvoice(iid);
S.recordPayment(iid, { amount_cents: 100000, fee_cents: 3030, method: 'card', stripe_session: 'cs_1', skip_email: true, skip_sms: true }, 'stripe');
const inv = D.one('SELECT * FROM invoices WHERE id=?', iid);
assert.equal(inv.status, 'paid', 'the fee is not counted toward the invoice balance'); assert.equal(inv.amount_paid_cents, 100000);
L.syncLedger(); const row = D.one("SELECT * FROM ledger WHERE src='payment'");
assert.equal(row.amount_cents, 103030, 'the ledger shows the full amount received'); assert.match(row.notes, /card processing fee/);
const pdf = await L.invoicePdf(iid); assert.ok(pdf.length > 1000, 'the invoice PDF builds with the fee notice');

// ---- over HTTP: save, public view, signature overrides
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-'));
const port = 5300 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 't.db'), DATA_DIR: dir, UPLOAD_DIR: dir, BASE_URL: base };
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env, stdio: 'pipe' });
let cookie = '';
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body == null ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
try {
  await new Promise((r) => setTimeout(r, 4500));
  await call('POST', '/api/admin/login', { email: 't@t.com', password: 'testpassword123' });
  const A = '/api/admin';
  const cust = (await call('POST', `${A}/customers`, { name: 'Sig Person', email: 's@example.com', phone: '5550002222' })).body.id;
  let r = await call('POST', `${A}/invoices`, { customer_id: cust, title: 'Fee test', items: [{ desc: 'Bus', qty: 1, unit_cents: 50000 }], tax_rate: 0, cc_fee_on: 1, cc_fee_pct: 3, cc_fee_flat_cents: 30 }); assert.equal(r.status, 200, JSON.stringify(r.body)); const id = r.body.id;
  const got = (await call('GET', `${A}/invoices/${id}`)).body; assert.equal(got.cc_fee_on, 1); assert.equal(got.cc_fee_pct, 3); assert.equal(got.cc_fee_flat_cents, 30);
  assert.equal((await call('POST', `${A}/invoices/${id}/send`, { skip_email: true })).status, 200);
  const tok = got.token; const pub = await (await fetch(`${base}/api/public/invoice/${tok}`)).json();
  assert.equal(pub.cc_fee.pct, 3); assert.equal(pub.cc_fee.flat_cents, 30); assert.match(pub.cc_fee.text, /processing fee of 3% \+ \$0\.30/);
  await call('PUT', `${A}/invoices/${id}`, { cc_fee_on: 0 }); assert.equal((await (await fetch(`${base}/api/public/invoice/${tok}`)).json()).cc_fee, null, 'turning it off removes the notice');
  assert.equal((await fetch(`${base}${A}/invoices/${id}/pdf`, { headers: { cookie } })).status, 200);

  // a quote with the signature override: the customer only clicks Accept
  const mkq = async () => (await call('POST', `${A}/quotes`, { customer_id: cust, title: 'Q', items: [{ desc: 'Bus', qty: 1, unit_cents: 90000 }], tax_rate: 0, deposit_pct: 50, trip: { itinerary: [{ kind: 'pickup', address: '1 A St' }, { kind: 'dropoff', address: '2 B St' }], depart_at: '2099-01-01T08:00' }, cc_fee_on: 1, cc_fee_pct: 2, cc_fee_flat_cents: 0 })).body.id;
  const q1 = await mkq(); await call('POST', `${A}/quotes/${q1}/send`, { skip_email: true, skip_sms: true });
  const qt = (await call('GET', `${A}/quotes/${q1}`)).body.token;
  let a = await fetch(`${base}/api/public/quote/${qt}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agree: true }) }); assert.equal(a.status, 400, 'a signature is required by default');
  await call('PUT', `${A}/quotes/${q1}`, { sig_waived: 1 });
  a = await fetch(`${base}/api/public/quote/${qt}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No Agree' }) }); assert.equal(a.status, 400, 'even with no signature needed, the terms must be agreed to');
  a = await fetch(`${base}/api/public/quote/${qt}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agree: true, name: 'Rabbi Sample' }) }); assert.equal(a.status, 200, 'with the override, agreeing to the terms is enough');
  const autoInv = (await call('GET', `${A}/invoices`)).body.find((x) => x.quote_id === q1); assert.equal(autoInv.cc_fee_on, 1, 'the quote card fee carries onto its invoice'); assert.equal(autoInv.cc_fee_pct, 2);

  // staff accept without a signature: logged, and a record shows on Contracts
  const q2 = await mkq(); await call('POST', `${A}/quotes/${q2}/send`, { skip_email: true, skip_sms: true });
  assert.equal((await call('POST', `${A}/quotes/${q2}/accept`, { reason: 'Signed on paper' })).status, 200);
  let cons = (await call('GET', `${A}/contracts`)).body; const k2 = cons.find((k) => k.status === 'signed' && /Signature waived/.test(k.signer_name)); assert.ok(k2, 'override shows as signed, waived'); assert.equal(k2.has_pdf, 0);
  // an existing unsigned agreement can be marked signed
  const q3 = await mkq(); await call('POST', `${A}/quotes/${q3}/send`, { skip_email: true, skip_sms: true });
  const ct = (await call('POST', `${A}/contracts`, { quote_id: q3 })).body; const cid2 = ct.id;
  assert.equal((await call('POST', `${A}/contracts/${cid2}/override`, { signed_by: 'Rabbi Sample', reason: 'phone approval' })).status, 200);
  cons = (await call('GET', `${A}/contracts`)).body; const k3 = cons.find((k) => k.id === cid2); assert.equal(k3.status, 'signed'); assert.equal(k3.signer_name, 'Rabbi Sample');
  assert.equal((await call('POST', `${A}/contracts/${cid2}/override`, {})).status, 400, 'cannot override twice');
  console.log('Card fee and override checks passed.');
} finally { srv.kill(); }
