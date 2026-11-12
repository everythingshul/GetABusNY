// Chesky checks: taught answers, unanswered log, handoff, rate limit, AI loop (mocked), no-key fallback. No network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gab-ch-'));
process.env.DB_PATH = path.join(dir, 't.db');
process.env.SESSION_SECRET = 'z'.repeat(32);
delete process.env.CHESKY_API_KEY; delete process.env.RESEND_API_KEY;
const { default: express } = await import('express');
const { chatPublicRouter, chatAdminRouter, execTool } = await import('../src/chesky.js');
const { all, one } = await import('../src/db.js');

const app = express();
app.use(express.json());
app.use('/p', chatPublicRouter());
app.use('/a', chatAdminRouter());
const srv = app.listen(0);
const base = `http://localhost:${srv.address().port}`;
const realFetch = globalThis.fetch;
const call = async (method, url, body) => { const r = await realFetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`, ++n && '');

try {
  // taught answers
  let r = await call('POST', '/a/learn/teach', { qs: ['Do you run on Shabbos?'], r: 'No. Our office is closed Saturday; call us for Motzei Shabbos pickups.' });
  assert.equal(r.status, 200); const learnedId = r.body.entry.id; ok('teach an answer');
  r = await call('POST', '/p/ask', { question: 'do you run on shabbos' }); assert.equal(r.body.entryId, learnedId); assert.match(r.body.reply, /closed Saturday/); ok('taught answer returned verbatim');
  r = await call('POST', '/p/ask', { question: 'Do you run on shabos?' }); assert.equal(r.body.entryId, learnedId); ok('typo still matches (fuzzy)');

  // no key: unanswered logged + polite fallback
  r = await call('POST', '/p/ask', { question: 'Can you take my dog sled team to Alaska?' });
  assert.equal(r.body.offTopic, true); assert.match(r.body.reply, /leave a message/i); assert.ok(!/\$\d/.test(r.body.reply)); ok('no API key: polite fallback, no prices');
  r = await call('GET', '/a/learn'); assert.equal(r.body.unanswered.length, 1); ok('unanswered question logged');
  await call('POST', '/p/log', { type: 'down', q: 'Is wifi on the bus?', entry: 'ai' });
  r = await call('GET', '/a/learn'); assert.equal(r.body.unanswered.length, 2); assert.equal(r.body.stats.ai.down, 1); ok('thumbs-down logged + stats');
  r = await call('POST', '/a/learn/teach', { qs: ['Can you take my dog sled team to Alaska?'], r: 'Not that one!' });
  r = await call('GET', '/a/learn'); assert.equal(r.body.unanswered.length, 1); ok('teaching clears the unanswered entry');

  // submit_quote_request tool with an itinerary
  const out = execTool('submit_quote_request', { name: 'Moshe K', phone: '5551230000', purpose: 'camp trip', pickup: 'Monsey NY', dropoff: 'Camp Morasha', depart_at: '2099-07-01T07:00', passengers: 48, stops: [{ kind: 'pickup', address: 'Lakewood NJ', time: '07:45' }, { kind: 'bogus', address: 'Rest stop' }, { kind: 'return_pickup', address: 'Camp Morasha' }, { kind: 'stop', address: '' }] });
  assert.equal(out.status, 'submitted'); const req = one('SELECT * FROM requests WHERE ref=?', out.reference); assert.ok(req); assert.match(req.details, /camp trip/); ok('quote request tool creates a lead');
  assert.equal(execTool('submit_quote_request', { name: 'X', pickup: 'a', dropoff: 'b', depart_at: 'c', passengers: 1 }).status, 'error'); ok('tool refuses without contact info');

  // mocked AI loop: submit then respond
  process.env.CHESKY_API_KEY = 'sk-test';
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
    const b = JSON.parse(opts.body); seen.push(b);
    const last = b.messages.at(-1);
    if (typeof last.content === 'string') return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_quote_request', input: { name: 'Dovid', email: 'd@example.com', pickup: 'Brooklyn', dropoff: 'Kivrei Tzadikim, Meron', depart_at: '2099-08-01T06:00', passengers: 30, purpose: 'Kivrei Tzadikim trip', stops: [{ kind: 'pickup', address: 'Boro Park' }] } }] }));
    const res = JSON.parse(last.content[0].content);
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'respond', input: { reply: `Got it, reference ${res.reference}. A team member will send your quote.`, offTopic: false, forwardToTeam: false } }] }));
  };
  r = await call('POST', '/p/ask', { question: 'I need a bus for a Kivrei Tzadikim trip, 30 people' });
  assert.match(r.body.reply, /reference REQ-/); assert.ok(r.body.submitted); ok('AI loop: tool call then respond');
  const sys = seen[0].system;
  assert.match(sys, /Never state, estimate/); assert.match(sys, /Shabbatons/); assert.match(sys, /closed Saturday/); assert.deepEqual(seen[0].tools.map((t) => t.name), ['get_fleet', 'get_hours_contact', 'submit_quote_request', 'respond']); ok('system prompt carries the hard rules');
  globalThis.fetch = realFetch; delete process.env.CHESKY_API_KEY;

  // handoff
  r = await call('POST', '/p/handoff', { name: 'Sara', email: 'bad', message: 'hi' }); assert.equal(r.status, 400); ok('handoff validates email');
  r = await call('POST', '/p/handoff', { name: 'Chaim', email: 'chaim@example.com', message: 'Need a bus for Shabbaton', transcript: [{ role: 'customer', text: 'hi' }, { role: 'bot', text: 'hello' }] });
  assert.equal(r.status, 200); const cid = r.body.id; const base0 = r.body.baselineId; ok('handoff conversation started');
  r = await call('GET', `/p/poll?id=${cid}&after=${base0}`); assert.equal(r.body.messages.length, 1); ok('poll skips baseline transcript');
  r = await call('GET', '/a'); assert.equal(r.body.conversations[0].unread, true); ok('shows unread in admin inbox');
  r = await call('POST', `/a/${cid}/reply`, { text: 'Sure, call us during office hours.', teach: { q: 'Can I get a bus for a Shabbaton?', a: 'Yes, send us the details and staff will quote it.' } });
  assert.equal(r.status, 200); assert.ok(r.body.taught); ok('admin reply + teach');
  r = await call('GET', `/p/poll?id=${cid}&after=${base0}`); assert.equal(r.body.messages.at(-1).from, 'admin'); ok('visitor sees admin reply');
  assert.ok(all('SELECT * FROM outbox').some((o) => o.to_addr === 'chaim@example.com')); ok('visitor emailed the reply');
  r = await call('POST', '/p/send', { id: cid, text: 'Thanks!' }); assert.equal(r.status, 200);
  await call('PUT', `/a/${cid}`, { status: 'closed' });
  r = await call('POST', '/p/send', { id: cid, text: 'more' }); assert.equal(r.status, 409); ok('closed conversation rejects messages');
  r = await call('GET', '/p/poll?id=doesnotexist123'); assert.equal(r.status, 404); ok('bad conversation id → 404');
  r = await call('DELETE', `/a/${cid}`); assert.equal(one('SELECT COUNT(*) c FROM chat_messages WHERE conversation_id=?', cid).c, 0); ok('delete cascades messages');

  // admin assistant fallback
  const { adminAssistant } = await import('../src/chesky.js');
  assert.match((await adminAssistant({ message: 'status?', session_id: 's', userId: 1 })).reply, /not connected/); ok('admin assistant falls back without a key');

  // rate limit (handoff: 10 per 15 min per IP; earlier calls count)
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await call('POST', '/p/handoff', { email: 'x', message: '' })).status === 429;
  assert.ok(limited); ok('handoff rate limit returns 429');

  console.log(`\nAll ${n} Chesky checks passed.`);
} catch (e) { console.error('\nFAILED:', e.stack || e.message); process.exitCode = 1; } finally { globalThis.fetch = realFetch; srv.close(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 100); }
