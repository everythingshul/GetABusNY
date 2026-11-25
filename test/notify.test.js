// Internal alert emails: one copy, to the alerts address when one is set.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
const d0 = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-'));
Object.assign(process.env, { DB_PATH: path.join(d0, 't.db'), DATA_DIR: d0, UPLOAD_DIR: d0, ADMIN_EMAIL: 'owner@gmail.example', ADMIN_PASSWORD: 'testpassword123', SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://localhost:1', BREVO_API_KEY: 'k' });
delete process.env.SMS_API_BASE;
const sent = [];
globalThis.fetch = async (url, o) => { const b = JSON.parse(o.body || '{}'); sent.push(b.to?.[0]?.email); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
const D = await import('../src/db.js'); const I = await import('../src/integrations.js');
D.insert('users', { email: 'owner@gmail.example', name: 'Owner', pass_hash: 'x', role: 'admin', created_at: D.now() });
// no alerts address: each admin gets one
D.setSetting('notify_email', ''); sent.length = 0; await I.notifyOwner('Payment', 'x', 'payment');
assert.deepEqual(sent, ['owner@gmail.example'], 'without an alerts address, the admin gets it');
// alerts address set: only that address, once
D.setSetting('notify_email', 'sales@example.com'); sent.length = 0; await I.notifyOwner('Payment', 'x', 'payment');
assert.deepEqual(sent, ['sales@example.com'], 'with an alerts address, nothing else gets a copy');
// two admins still produce one email
D.insert('users', { email: 'second@example.com', name: 'Second', pass_hash: 'x', role: 'admin', created_at: D.now() });
sent.length = 0; await I.notifyOwner('New lead', 'x', 'new_lead'); assert.deepEqual(sent, ['sales@example.com'], 'still one copy');
console.log('Notify checks passed.');
