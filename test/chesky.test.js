// Chesky checks: taught answers, unanswered log, handoff, rate limit, AI loop (mocked), no-key fallback,
// voice notes and photos (validation, transcription mocked, image block sent to Claude, voice files and access control). No network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gab-ch-'));
process.env.DB_PATH = path.join(dir, 't.db');
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = 'z'.repeat(32);
delete process.env.CHESKY_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.OPENAI_API_KEY;
const { default: express } = await import('express');
const { chatPublicRouter, chatAdminRouter, execTool, checkMedia, sniffImage, sniffAudio, setTranscriber } = await import('../src/chesky.js');
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
  assert.match(sys, /Never state, estimate/); assert.match(sys, /Shabbatons/); assert.match(sys, /closed Saturday/); assert.deepEqual(seen[0].tools.map((t) => t.name), ['get_fleet', 'get_hours_contact', 'get_site_info', 'find_invoice', 'start_invoice_payment', 'submit_quote_request', 'respond']); ok('system prompt carries the hard rules');
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

  // ---------- photos and voice notes ----------
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 3)]);
  const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(400, 4)]);
  const raw = async (url, buf, type) => { const r = await realFetch(base + url, { method: 'POST', headers: { 'content-type': type }, body: buf }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  assert.equal(sniffImage(png), 'image/png'); assert.equal(sniffImage(jpg), 'image/jpeg'); assert.equal(sniffImage(webp), 'image/webp');
  assert.equal(sniffImage(Buffer.from('GIF89a......................')), null); assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null); ok('image magic bytes: png, jpg, webp accepted; gif and svg refused');
  assert.ok(checkMedia('image', 'image/png', png).mime); assert.ok(checkMedia('image', 'image/jpeg', jpg).mime); assert.ok(checkMedia('image', 'image/webp', webp).mime);
  assert.ok(checkMedia('image', 'image/jpeg', png).error, 'png bytes claimed as jpeg');
  assert.ok(checkMedia('image', 'image/svg+xml', png).error); assert.ok(checkMedia('image', 'image/gif', png).error);
  assert.ok(checkMedia('image', 'image/png', Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)])).error); ok('photo checks: type, mismatch, and 6MB cap');
  assert.equal(sniffAudio(webm), 'audio/webm'); assert.equal(sniffAudio(m4a), 'audio/mp4');
  assert.ok(checkMedia('voice', 'audio/webm;codecs=opus', webm).mime); assert.ok(checkMedia('voice', 'audio/mp4', m4a).mime);
  assert.ok(checkMedia('voice', 'audio/webm', Buffer.alloc(50)).error, 'too short'); assert.ok(checkMedia('voice', 'audio/webm', m4a).error, 'mismatch');
  assert.ok(checkMedia('voice', 'audio/mpeg', webm).error); assert.ok(checkMedia('voice', 'audio/webm', Buffer.concat([webm, Buffer.alloc(3 * 1024 * 1024)])).error); ok('voice checks: type, mismatch, too short, size cap');

  // upload endpoint
  r = await raw('/p/media?kind=image', png, 'image/png'); assert.equal(r.status, 200); assert.ok(r.body.id); const imgId = r.body.id;
  assert.equal((await raw('/p/media?kind=image', png, 'image/jpeg')).status, 400);
  assert.equal((await raw('/p/media', png, 'image/png')).status, 400);
  assert.equal((await raw('/p/media?kind=voice', png, 'image/png')).status, 400);
  assert.equal((await raw('/p/media?kind=image', Buffer.from('hello'), 'text/plain')).status, 400); ok('upload endpoint accepts real files and rejects bad ones');

  // photo reaches Claude as an image block (and is not written to disk)
  process.env.CHESKY_API_KEY = 'sk-test';
  const seen2 = [];
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
    const b = JSON.parse(opts.body); seen2.push(b);
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tr', name: 'respond', input: { reply: 'I can read the schedule: pickups at 7:00 and 7:20. Is that right?', offTopic: false, forwardToTeam: false } }] }));
  };
  r = await call('POST', '/p/ask', { question: 'do you run on shabbos', image_id: imgId });
  assert.equal(r.status, 200); assert.match(r.body.reply, /read the schedule/);
  const lastUser = seen2.at(-1).messages.at(-1).content;
  assert.ok(Array.isArray(lastUser)); assert.equal(lastUser[0].type, 'image'); assert.equal(lastUser[0].source.type, 'base64'); assert.equal(lastUser[0].source.media_type, 'image/png'); assert.equal(lastUser[0].source.data, png.toString('base64'));
  assert.equal(lastUser[1].type, 'text'); assert.match(lastUser[1].text, /shabbos/); ok('image sent to Claude as a base64 image block (taught-answer shortcut skipped)');
  assert.match(seen2[0].system, /trip schedule/); assert.match(seen2[0].system, /Never identify, describe or comment on people/); assert.match(seen2[0].system, /Never give prices/); assert.match(seen2[0].system, /The visitor just sent an image/); ok('system prompt: read schedules, confirm before quoting, ignore people, no prices');
  r = await call('POST', '/p/ask', { question: 'again', image_id: imgId }); assert.equal(r.status, 400); ok('an upload can only be used once');
  const vdir = path.join(dir, 'chat-voice');
  assert.ok(!fs.existsSync(vdir) || fs.readdirSync(vdir).length === 0); ok('AI photos are never saved to disk');

  // voice note in the AI chat: transcribed, merged into the question
  setTranscriber(async () => 'I need a bus for forty people to camp on Sunday');
  r = await raw('/p/media?kind=voice&dur=4.2&peaks=10,40,70,30', webm, 'audio/webm;codecs=opus'); assert.equal(r.status, 200); const vId = r.body.id;
  r = await call('POST', '/p/ask', { question: '', voice_id: vId });
  assert.equal(r.status, 200); assert.equal(r.body.voiceTranscript, 'I need a bus for forty people to camp on Sunday');
  const vUser = seen2.at(-1).messages.at(-1).content; assert.equal(typeof vUser, 'string'); assert.match(vUser, /forty people to camp/); assert.match(seen2.at(-1).system, /voice note/i); ok('voice note transcribed and sent to Claude as text');
  r = await raw('/p/media?kind=voice', webm, 'audio/webm'); const typedAndVoice = await call('POST', '/p/ask', { question: 'Also a stop at the Ohel.', voice_id: r.body.id });
  assert.match(seen2.at(-1).messages.at(-1).content, /Also a stop at the Ohel\.\nI need a bus/); ok('typed text and voice transcript are combined');
  setTranscriber(async () => '   ');
  r = await raw('/p/media?kind=voice', webm, 'audio/webm'); r = await call('POST', '/p/ask', { question: '', voice_id: r.body.id });
  assert.equal(r.status, 200); assert.match(r.body.reply, /couldn't make out/); ok('silent recording gets a friendly retry message');
  setTranscriber(null);
  r = await raw('/p/media?kind=voice', webm, 'audio/webm'); r = await call('POST', '/p/ask', { question: '', voice_id: r.body.id });
  assert.equal(r.status, 503); assert.match(r.body.error, /type/i); ok('no OPENAI_API_KEY: polite message asking them to type');
  globalThis.fetch = realFetch; delete process.env.CHESKY_API_KEY;

  // voice note to a person: saved as a file, transcript shown, served only with the conversation id
  setTranscriber(async () => 'Please call me back about Sunday');
  r = await call('POST', '/p/handoff', { name: 'Leah', email: 'leah@example.com', message: 'Hello, quick question' }); const hc = r.body.id;
  r = await raw('/p/media?kind=voice&dur=6&peaks=20,50,80', webm, 'audio/webm'); r = await call('POST', '/p/send', { id: hc, voice_id: r.body.id });
  assert.equal(r.status, 200); assert.equal(r.body.transcript, 'Please call me back about Sunday'); const vmsgId = r.body.lastId;
  const files = fs.readdirSync(vdir); assert.equal(files.length, 1); assert.match(files[0], /^voice-[0-9a-f]{32}\.webm$/); assert.ok(!fs.existsSync(path.join(dir, 'uploads'))); ok('voice note saved with an unguessable file name, outside the public uploads folder');
  r = await call('GET', `/p/poll?id=${hc}&after=0`); const vm = r.body.messages.find((m) => m.id === vmsgId);
  assert.equal(vm.text, 'Please call me back about Sunday'); assert.equal(vm.voice.dur, 6); assert.deepEqual(vm.voice.peaks, [20, 50, 80]); assert.equal(vm.voice.url, `/api/public/chesky/voice/${hc}/${vmsgId}`); ok('poll returns the voice note with transcript, duration and waveform');
  let vr = await realFetch(`${base}/p/voice/${hc}/${vmsgId}`); assert.equal(vr.status, 200); assert.match(vr.headers.get('content-type'), /audio\/webm/); assert.ok(Buffer.from(await vr.arrayBuffer()).equals(webm)); ok('voice file served to someone holding the conversation id');
  r = await call('POST', '/p/handoff', { name: 'Other', email: 'other@example.com', message: 'another chat' }); const other = r.body.id;
  assert.equal((await realFetch(`${base}/p/voice/${other}/${vmsgId}`)).status, 404); assert.equal((await realFetch(`${base}/p/voice/doesnotexist12345/${vmsgId}`)).status, 404); assert.equal((await realFetch(`${base}/p/voice/${hc}/99999`)).status, 404); ok('voice route refuses the wrong conversation, unknown ids and unknown messages');
  r = await call('GET', `/a/${hc}`); const am = r.body.messages.find((m) => m.id === vmsgId); assert.equal(am.voice.url, `/api/admin/chesky/${hc}/voice/${vmsgId}`); assert.equal(am.text, 'Please call me back about Sunday');
  vr = await realFetch(`${base}/a/${hc}/voice/${vmsgId}`); assert.equal(vr.status, 200); r = await call('GET', '/a'); assert.equal(r.body.conversations.find((c) => c.id === hc).last, 'Please call me back about Sunday'); ok('admin sees the voice note, its transcript and can play the file');
  setTranscriber(async () => { throw new Error('whisper down'); });
  r = await raw('/p/media?kind=voice', webm, 'audio/webm'); r = await call('POST', '/p/send', { id: hc, voice_id: r.body.id }); assert.equal(r.status, 200); assert.equal(r.body.transcript, ''); ok('transcription failure never blocks sending the recording');
  assert.equal((await call('POST', '/p/send', { id: hc, voice_id: 'mnotreal' })).status, 400); ok('expired or unknown voice id is rejected');
  setTranscriber(async () => 'Voice only first message');
  r = await raw('/p/media?kind=voice', webm, 'audio/webm'); r = await call('POST', '/p/handoff', { email: 'voice@example.com', voice_id: r.body.id }); assert.equal(r.status, 200); ok('a conversation can start with just a voice note');
  const before = fs.readdirSync(vdir).length; await call('DELETE', `/a/${hc}`); assert.ok(fs.readdirSync(vdir).length < before); ok('deleting a conversation deletes its voice files');
  setTranscriber(null);


  // site info: everything on the public pages, nothing private
  { const { siteInfo } = await import('../src/chesky.js'); const all0 = siteInfo('all');
    assert.ok(all0.fleet.length >= 10 && all0.fleet.some((v) => v.amenities.length > 2 && v.page.startsWith('/bus/')));
    assert.equal(all0.areas.length, 17); assert.ok(all0.areas.some((a) => a.name === 'Boro Park')); assert.ok(all0.trips.some((t) => t.name === 'Weddings' && t.faq.length));
    assert.match(all0.about, /2016/); assert.ok(all0.terms.length > 500 && !/<[a-z]/i.test(all0.terms)); assert.ok(all0.privacy.length > 200);
    assert.match(all0.contact.hours, /Saturday: Closed/); assert.equal(typeof all0.page_texts, 'object');
    assert.deepEqual(Object.keys(siteInfo('areas')), ['areas']); const dump = JSON.stringify(all0); assert.ok(!/token|password|stripe_customer/i.test(dump) || !/"token"/.test(dump));
    assert.equal(execTool('get_site_info', { section: 'fleet' }).fleet.length, all0.fleet.length); ok('get_site_info returns the whole public site and nothing private'); }

  // invoice payment by chat
  { const { insert, now, token: tok } = await import('../src/db.js'); const { execToolAsync } = await import('../src/chesky.js');
    const cid = insert('customers', { name: 'Pay Er', email: 'payer@example.com', phone: '5550001111', created_at: now(), updated_at: now() });
    const inv = insert('invoices', { number: 'INV-777777', seq: 1, token: tok(), customer_id: cid, status: 'sent', title: 'Camp trip', items: [], subtotal_cents: 50000, total_cents: 50000, amount_paid_cents: 10000, deposit_cents: 20000, due_date: '2099-07-01', created_at: now(), updated_at: now() });
    const ctx = { ip: '9.9.9.9' };
    let f = await execToolAsync('find_invoice', { number: 'inv-777777', email: 'PAYER@example.com' }, ctx);
    assert.equal(f.status, 'found'); assert.equal(f.balance, '$400.00'); assert.equal(f.due_date, 'July 1, 2099'); assert.ok(!JSON.stringify(f).includes('token'));
    f = await execToolAsync('find_invoice', { number: 'INV-777777', email: 'someone@else.com' }, ctx); assert.equal(f.status, 'not_found');
    assert.equal((await execToolAsync('start_invoice_payment', { number: 'INV-777777', email: 'wrong@x.com' }, ctx)).status, 'error');
    assert.match((await execToolAsync('start_invoice_payment', { number: 'INV-777777', email: 'payer@example.com' }, ctx)).error, /not set up/);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'; const stripeBodies = [];
    globalThis.fetch = async (url, opts) => { if (!String(url).includes('api.stripe.com')) return realFetch(url, opts); stripeBodies.push(String(opts.body)); return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/c/1', client_secret: 'cs_secret_1' }), { status: 200 }); };
    let p = await execToolAsync('start_invoice_payment', { number: 'INV-777777', email: 'payer@example.com' }, ctx);
    assert.equal(p.status, 'ready'); assert.equal(p._checkout.url, 'https://checkout.stripe.test/c/1'); assert.equal(p._checkout.clientSecret, undefined); assert.ok(stripeBodies[0].includes('success_url') && !stripeBodies[0].includes('ui_mode') && stripeBodies[0].includes('unit_amount%5D=40000'));
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    p = await execToolAsync('start_invoice_payment', { number: 'INV-777777', email: 'payer@example.com', which: 'deposit' }, ctx);
    assert.equal(p._checkout.clientSecret, 'cs_secret_1'); assert.equal(p._checkout.publishableKey, 'pk_test_x'); assert.ok(stripeBodies[1].includes('ui_mode=embedded') && stripeBodies[1].includes('return_url') && stripeBodies[1].includes('unit_amount%5D=10000'));
    // whole ask() loop: the secret reaches the widget, never the model
    process.env.CHESKY_API_KEY = 'k'; let toolResultSeen = '';
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('api.stripe.com')) return new Response(JSON.stringify({ id: 'cs_2', client_secret: 'cs_secret_2' }), { status: 200 });
      if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
      const b = JSON.parse(opts.body); const last = b.messages[b.messages.length - 1];
      if (typeof last.content === 'string') return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't9', name: 'start_invoice_payment', input: { number: 'INV-777777', email: 'payer@example.com' } }] }), { status: 200 });
      toolResultSeen = JSON.stringify(last.content);
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't10', name: 'respond', input: { reply: 'The payment form is below.' } }] }), { status: 200 });
    };
    const { ask } = await import('../src/chesky.js'); const a = await ask('I want to pay INV-777777, payer@example.com', [], null, false, ctx);
    assert.equal(a.checkout.clientSecret, 'cs_secret_2'); assert.equal(a.reply, 'The payment form is below.'); assert.ok(!toolResultSeen.includes('cs_secret_2') && toolResultSeen.includes('ready'));
    // lookup guessing is limited per visitor
    const bad = { ip: '8.8.8.8' }; for (let i = 0; i < 6; i++) await execToolAsync('find_invoice', { number: `INV-${i}`, email: 'a@b.com' }, bad);
    assert.match((await execToolAsync('find_invoice', { number: 'INV-777777', email: 'payer@example.com' }, bad)).error, /Too many/);
    globalThis.fetch = realFetch; delete process.env.CHESKY_API_KEY; delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PUBLISHABLE_KEY;
    ok('invoice lookup needs number and email, payment form is created on Stripe, secret goes to the widget only, guessing is limited'); }

  // admin assistant fallback
  const { adminAssistant } = await import('../src/chesky.js');
  assert.match((await adminAssistant({ message: 'status?', session_id: 's', userId: 1 })).reply, /not connected/); ok('admin assistant falls back without a key');

  // rate limit (handoff: 10 per 15 min per IP; earlier calls count)
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await call('POST', '/p/handoff', { email: 'x', message: '' })).status === 429;
  assert.ok(limited); ok('handoff rate limit returns 429');

  console.log(`\nAll ${n} Chesky checks passed.`);
} catch (e) { console.error('\nFAILED:', e.stack || e.message); process.exitCode = 1; } finally { globalThis.fetch = realFetch; srv.close(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 100); }
