// Chesky widget (ported from JListings): AI chat first, "talk to a real person" handoff second.
// Visitors can attach one photo and/or record a voice note.
// Usage: import { initChesky } from '/js/chesky.js'; initChesky({ name: 'Chesky', phone: '+1…' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const API = '/api/public/chesky';
const K_CONV = 'chesky_conv_id', K_TR = 'chesky_transcript';
const UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/></svg>';
const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-8 8"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
};
const IMG_OK = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_REC = 65;
const fmtDur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const STARTERS = ['I need a bus for a camp trip', 'Which bus fits my group?', 'What are your hours?', 'Do you do Shabbatons and Kehila trips?'];

async function req(path, body) {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function initChesky(config = {}) {
  if (document.getElementById('chesky-root')) return;
  const name = config.name || 'Chesky';
  if (!document.querySelector('link[href="/css/chesky.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/css/chesky.css' }));
  const store = (() => { try { return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), ss: sessionStorage }; } catch { return { get: () => null, set: () => {}, ss: { getItem: () => null, setItem: () => {} } }; } })();

  let convId = store.get(K_CONV), convStatus = 'open', lastId = 0, poll = null, busy = false, opened = false;
  let transcript = []; try { transcript = JSON.parse(store.ss.getItem(K_TR) || '[]'); } catch { /* fresh */ }
  const saveTr = () => { try { store.ss.setItem(K_TR, JSON.stringify(transcript.slice(-16))); } catch { /* ignore */ } };
  let mode = 'ai'; // ai | handoff | human
  const pending = { image: null, voice: null }; // attached, not yet sent
  let rec = null;

  const root = el(`<div id="chesky-root"><button class="chesky-fab" aria-label="Chat with ${esc(name)}"><img src="/img/chesky.svg" alt=""><span class="chesky-close-ico">&times;</span><span class="chesky-unread" hidden></span></button>
  <section class="chesky-panel" role="dialog" aria-label="Chat with ${esc(name)}" hidden><header class="chesky-head"><img src="/img/chesky.svg" alt=""><div><b>${esc(name)}</b><small>Get A Bus NY assistant · a person confirms every quote</small></div><button class="chesky-restart" title="Start over" aria-label="Start over">&#8635;</button><button class="chesky-x" aria-label="Close">&times;</button></header>
  <div class="chesky-log" id="cheskyLog" aria-live="polite"></div><div class="chesky-foot" id="cheskyFoot"></div></section></div>`);
  document.body.append(root);
  const fab = root.querySelector('.chesky-fab'), panel = root.querySelector('.chesky-panel'), badge = root.querySelector('.chesky-unread');
  const log = () => root.querySelector('#cheskyLog'), foot = () => root.querySelector('#cheskyFoot');
  const scroll = () => { log().scrollTop = log().scrollHeight; };

  function bubble(from, html, extra = '') {
    const n = el(`<div class="chesky-msg from-${from}">${from === 'visitor' ? '' : `<div class="chesky-msg-who">${from === 'admin' ? 'Team' : esc(name)}</div>`}<div class="chesky-bubble">${html}</div>${extra}</div>`);
    log().append(n); wireVoices(n); scroll(); return n;
  }
  const typing = () => { const n = el('<div class="chesky-msg from-bot"><div class="chesky-typing"><span></span><span></span><span></span></div></div>'); log().append(n); scroll(); return n; };
  const wireTextarea = (ta) => {
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); return; }
      ta.form?.requestSubmit();
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'; });
  };

  // --- photos and voice notes ---
  async function upload(kind, blob, mime, extra = {}) {
    const qs = new URLSearchParams({ kind, ...(extra.dur ? { dur: String(extra.dur) } : {}), ...(extra.peaks?.length ? { peaks: extra.peaks.join(',') } : {}) });
    const r = await fetch(`${API}/media?${qs}`, { method: 'POST', headers: { 'content-type': mime }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The upload did not work. Please try again.');
    return j.id;
  }
  // Big phone photos are shrunk first so they upload fast and stay under the 6MB limit. Text in screenshots stays readable.
  async function prepImage(file) {
    if (!IMG_OK.includes(file.type)) throw new Error('Please choose a JPG, PNG or WEBP photo.');
    if (file.size <= 3.5 * 1024 * 1024) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob || blob.size > 5.8 * 1024 * 1024) throw new Error('That photo is too large. Try a smaller one.');
    return blob;
  }
  const recSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';

  function voiceHtml(v, caption) {
    const peaks = v.peaks && v.peaks.length ? v.peaks : Array.from({ length: 24 }, (_, i) => 30 + ((i * 37) % 45));
    const bars = peaks.map((p) => `<i style="height:${Math.max(15, Math.min(100, p))}%"></i>`).join('');
    return `<div class="chesky-voice" data-src="${esc(v.url)}"><button type="button" class="chesky-vp-btn" aria-label="Play voice note">${ICON.play}</button><div class="chesky-vp-wave" aria-hidden="true">${bars}</div><span class="chesky-vp-dur">${fmtDur(v.dur)}</span></div>${caption ? `<div class="chesky-voice-transcript">${esc(caption)}</div>` : ''}`;
  }
  function wireVoices(scope) {
    scope.querySelectorAll('.chesky-voice:not([data-w])').forEach((el) => {
      el.dataset.w = '1';
      const btn = el.querySelector('.chesky-vp-btn'), bars = [...el.querySelectorAll('.chesky-vp-wave i')];
      let audio = null;
      const paint = (f) => bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < f));
      btn.onclick = () => {
        if (!audio) {
          audio = new Audio(el.dataset.src);
          audio.ontimeupdate = () => paint(audio.duration ? audio.currentTime / audio.duration : 0);
          audio.onended = () => { btn.innerHTML = ICON.play; paint(0); };
          audio.onerror = () => { btn.innerHTML = ICON.play; };
        }
        if (audio.paused) { document.querySelectorAll('audio').forEach((a) => a.pause()); audio.play().then(() => { btn.innerHTML = ICON.pause; btn.setAttribute('aria-label', 'Pause voice note'); }).catch(() => {}); }
        else { audio.pause(); btn.innerHTML = ICON.play; btn.setAttribute('aria-label', 'Play voice note'); }
      };
    });
  }

  function renderTray() {
    const tray = foot().querySelector('#cTray'); if (!tray) return;
    const bits = [];
    if (pending.image) bits.push(`<div class="chesky-chip-att" data-att="image"><img src="${esc(pending.image.url)}" alt="Photo to send"><span>Photo</span><button type="button" aria-label="Remove photo">${ICON.x}</button></div>`);
    if (pending.voice) bits.push(`<div class="chesky-chip-att" data-att="voice"><button type="button" class="chesky-att-play" aria-label="Play your recording">${ICON.play}</button><span>Voice note ${fmtDur(pending.voice.dur)}</span><button type="button" class="chesky-att-x" aria-label="Remove voice note">${ICON.x}</button></div>`);
    tray.innerHTML = bits.join(''); tray.hidden = !bits.length;
    tray.querySelector('[data-att=image] button')?.addEventListener('click', () => { pending.image = null; renderTray(); });
    tray.querySelector('.chesky-att-x')?.addEventListener('click', () => { pending.voice = null; renderTray(); });
    tray.querySelector('.chesky-att-play')?.addEventListener('click', (e) => { const a = new Audio(pending.voice.url); a.play().catch(() => {}); e.currentTarget.blur(); });
  }
  const refooter = () => { if (mode === 'human') chatFooter(); else if (mode === 'handoff') handoffForm(); else askFooter(); };

  async function beginRecord(target) { // target: 'attach' (AI chat) or 'send' (talking to a person)
    if (rec) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { bubble('bot', 'I cannot reach your microphone. Allow it in your browser settings, or type your message instead.'); return; }
    const mimeType = pickMime();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const r = { mr, stream, chunks: [], t0: Date.now(), peaks: [], cancelled: false, target };
    rec = r;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.onstop = () => finishRecord(r);
    try { // cosmetic level meter; recording works without it
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an); r.ctx = ctx; r.an = an; r.buf = new Uint8Array(an.frequencyBinCount);
    } catch { /* no meter */ }
    mr.start(250);
    foot().innerHTML = `<div class="chesky-rec" role="group" aria-label="Recording a voice note"><span class="chesky-rec-dot" aria-hidden="true"></span><span class="chesky-rec-time" role="timer" aria-live="off">0:00</span><div class="chesky-rec-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><button type="button" class="chesky-rec-cancel" aria-label="Cancel recording">Cancel</button><button type="button" class="chesky-rec-done" aria-label="Finish recording">${ICON.check}<span>Done</span></button></div>`;
    const tEl = foot().querySelector('.chesky-rec-time'), meter = [...foot().querySelectorAll('.chesky-rec-meter i')];
    foot().querySelector('.chesky-rec-cancel').onclick = () => stopRec(true);
    foot().querySelector('.chesky-rec-done').onclick = () => stopRec(false);
    r.tick = setInterval(() => {
      const sec = (Date.now() - r.t0) / 1000; tEl.textContent = fmtDur(sec);
      let level = 0.2;
      if (r.an) { r.an.getByteTimeDomainData(r.buf); let peak = 0; for (const v of r.buf) peak = Math.max(peak, Math.abs(v - 128)); level = Math.min(1, peak / 90); r.peaks.push(Math.round(20 + level * 80)); }
      meter.forEach((b, i) => { b.style.height = `${18 + Math.round(level * 82 * (0.55 + 0.45 * Math.sin(Date.now() / 130 + i)))}%`; });
      if (sec >= MAX_REC) stopRec(false);
    }, 120);
  }
  function stopRec(cancel) {
    if (!rec) return;
    rec.cancelled = !!cancel;
    try { rec.mr.stop(); } catch { finishRecord(rec); }
  }
  function finishRecord(r) {
    if (rec !== r) return;
    rec = null; clearInterval(r.tick); r.stream.getTracks().forEach((t) => t.stop()); try { r.ctx && r.ctx.close(); } catch { /* ignore */ }
    refooter();
    if (r.cancelled) return;
    const dur = Math.min(MAX_REC, (Date.now() - r.t0) / 1000);
    if (dur < 0.7 || !r.chunks.length) { bubble('bot', 'That recording was too short. Tap the microphone and try again.'); return; }
    const mime = (r.mr.mimeType || pickMime() || 'audio/webm').split(';')[0];
    const blob = new Blob(r.chunks, { type: mime });
    const step = Math.max(1, Math.floor(r.peaks.length / 24)), peaks = [];
    for (let i = 0; i < r.peaks.length && peaks.length < 24; i += step) peaks.push(r.peaks[i]);
    const v = { blob, mime, dur, peaks, url: URL.createObjectURL(blob) };
    if (r.target === 'send') sendVoiceToPerson(v);
    else { pending.voice = v; renderTray(); }
  }
  function stopRecSilently() { if (rec) stopRec(true); }

  // --- AI mode ---
  function askFooter() {
    mode = 'ai';
    foot().innerHTML = `<div class="chesky-tray" id="cTray" hidden></div><form class="chesky-form" id="cAsk"><button type="button" class="chesky-icon-btn" id="cPhoto" aria-label="Attach a photo or screenshot" title="Attach a photo or screenshot">${ICON.photo}</button>${recSupported() ? `<button type="button" class="chesky-icon-btn" id="cMic" aria-label="Record a voice note" title="Record a voice note">${ICON.mic}</button>` : ''}<textarea name="q" rows="1" placeholder="Ask a question or start a quote…" maxlength="1500" aria-label="Your message"></textarea><button type="submit" class="chesky-send">Send</button></form><input type="file" id="cFile" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="chesky-human"><button type="button" id="cHuman">Talk to a real person &rarr;</button></div>`;
    const f = foot().querySelector('#cAsk');
    wireTextarea(f.q);
    f.onsubmit = (e) => { e.preventDefault(); const q = f.q.value; f.q.value = ''; f.q.style.height = ''; ask(q); };
    foot().querySelector('#cHuman').onclick = handoffForm;
    const file = foot().querySelector('#cFile');
    foot().querySelector('#cPhoto').onclick = () => file.click();
    file.onchange = async () => {
      const fl = file.files[0]; file.value = ''; if (!fl) return;
      try { const blob = await prepImage(fl); if (pending.image) URL.revokeObjectURL(pending.image.url); pending.image = { blob, mime: blob.type, url: URL.createObjectURL(blob) }; renderTray(); } catch (e) { bubble('bot', esc(e.message)); }
    };
    foot().querySelector('#cMic')?.addEventListener('click', () => beginRecord('attach'));
    renderTray();
  }
  async function ask(q) {
    q = q.trim();
    const att = { image: pending.image, voice: pending.voice };
    if ((!q && !att.image && !att.voice) || busy) return; busy = true;
    pending.image = null; pending.voice = null; renderTray();
    log().querySelectorAll('.chesky-starters').forEach((n) => n.remove());
    const parts = [];
    if (att.image) parts.push(`<img class="chesky-sent-photo" src="${esc(att.image.url)}" alt="Photo you sent">`);
    if (att.voice) parts.push(voiceHtml({ url: att.voice.url, dur: att.voice.dur, peaks: att.voice.peaks }, ''));
    if (q) parts.push(esc(q));
    const mine = bubble('visitor', parts.join(''));
    const t = typing();
    try {
      const body = { question: q, transcript, page: location.pathname };
      if (att.image) body.image_id = await upload('image', att.image.blob, att.image.mime);
      if (att.voice) body.voice_id = await upload('voice', att.voice.blob, att.voice.mime, { dur: att.voice.dur, peaks: att.voice.peaks });
      const r = await req('/ask', body);
      if (att.voice && r.voiceTranscript) mine.querySelector('.chesky-bubble').insertAdjacentHTML('beforeend', `<div class="chesky-voice-transcript">${esc(r.voiceTranscript)}</div>`);
      const said = [q, r.voiceTranscript].filter(Boolean).join(' ') || '(sent a photo)';
      transcript.push({ role: 'user', text: att.image ? `${said} [photo attached]` : said }, { role: 'assistant', text: r.reply }); saveTr();
      t.remove();
      const n = bubble('bot', esc(r.reply).replace(/\n/g, '<br>'), `<div class="chesky-fb"><button data-fb="up" title="Helpful" aria-label="Helpful">${UP}</button><button data-fb="down" title="Not helpful" aria-label="Not helpful">${DOWN}</button></div>`);
      n.querySelectorAll('.chesky-fb button').forEach((b) => b.onclick = () => { n.querySelectorAll('.chesky-fb button').forEach((x) => x.classList.remove('picked')); b.classList.add('picked'); req('/log', { type: b.dataset.fb, q: said, entry: r.entryId }).catch(() => {}); });
      if (r.submitted) bubble('bot', `Reference <b>${esc(r.submitted.reference)}</b>. We'll be in touch.`);
      if (r.offTopic) { const b = el('<div style="text-align:center"><button class="chesky-link" type="button">Talk to a real person &rarr;</button></div>'); b.firstChild.onclick = handoffForm; log().append(b); scroll(); }
    } catch (e) { t.remove(); bubble('bot', esc(e.message)); } finally { busy = false; }
  }
  function greet() {
    bubble('bot', `Hi, I'm ${esc(name)}. I can help you pick a bus for a camp trip, Shabbaton, Kehila trip, Kivrei Tzadikim, school trip or simcha, and start your quote request. What are you planning?`);
    const s = el(`<div class="chesky-chips chesky-starters">${STARTERS.map((x) => `<button type="button" class="chesky-chip">${esc(x)}</button>`).join('')}</div>`);
    s.onclick = (e) => { const b = e.target.closest('.chesky-chip'); if (b) ask(b.textContent); };
    log().append(s);
  }

  // --- human handoff ---
  function handoffForm() {
    mode = 'handoff'; stopRecSilently();
    foot().innerHTML = `<form class="chesky-handoff" id="cHand"><div class="chesky-handoff-head"><span>Talk to a real person</span><button type="button" id="cCancel" aria-label="Cancel">&times;</button></div>
    <label>Your name<input name="name" autocomplete="name"></label><label>Email or reply address *<input name="email" type="email" required autocomplete="email"></label><label>Message *<textarea name="message" rows="2" required></textarea></label><button type="submit">Start conversation</button></form>`;
    foot().querySelector('#cCancel').onclick = askFooter;
    const f = foot().querySelector('#cHand');
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      const d = Object.fromEntries(new FormData(f));
      try {
        const r = await req('/handoff', { ...d, page: location.pathname, transcript: transcript.map((m) => ({ role: m.role === 'user' ? 'customer' : 'bot', text: m.text })) });
        convId = r.id; store.set(K_CONV, convId); lastId = r.baselineId || 0; convStatus = 'open';
        bubble('bot', 'Thanks! A real person on our team will reply here soon. Feel free to keep chatting. Our office is closed Saturday.');
        chatFooter(); startPoll();
      } catch (err) { btn.disabled = false; bubble('bot', esc(err.message)); }
    };
  }
  function chatFooter() {
    mode = 'human';
    const closed = convStatus === 'closed';
    foot().innerHTML = `${closed ? '<p class="chesky-note">This conversation has ended.</p>' : ''}<form class="chesky-form" id="cSend">${recSupported() && !closed ? `<button type="button" class="chesky-icon-btn" id="cMic2" aria-label="Record a voice note for our team" title="Record a voice note">${ICON.mic}</button>` : ''}<textarea name="t" rows="1" placeholder="Type a message…" aria-label="Your message" ${closed ? 'disabled' : ''}></textarea><button class="chesky-send" ${closed ? 'disabled' : ''}>Send</button></form><div class="chesky-human"><button type="button" id="cNew">Start a new chat</button></div>`;
    const f = foot().querySelector('#cSend'); wireTextarea(f.t);
    foot().querySelector('#cNew').onclick = reset;
    foot().querySelector('#cMic2')?.addEventListener('click', () => beginRecord('send'));
    f.onsubmit = async (e) => { e.preventDefault(); const t = f.t.value.trim(); if (!t) return; f.t.value = ''; f.t.style.height = ''; bubble('visitor', esc(t)); try { const r = await req('/send', { id: convId, text: t }); if (r.lastId > lastId) lastId = r.lastId; } catch (err) { bubble('bot', esc(err.message)); } };
  }
  async function sendVoiceToPerson(v) {
    const mine = bubble('visitor', voiceHtml({ url: v.url, dur: v.dur, peaks: v.peaks }, ''));
    try {
      const id = await upload('voice', v.blob, v.mime, { dur: v.dur, peaks: v.peaks });
      const r = await req('/send', { id: convId, voice_id: id });
      if (r.lastId > lastId) lastId = r.lastId;
      if (r.transcript) mine.querySelector('.chesky-bubble').insertAdjacentHTML('beforeend', `<div class="chesky-voice-transcript">${esc(r.transcript)}</div>`);
    } catch (err) { bubble('bot', esc(err.message)); }
  }
  function addIncoming(msgs) { let n = 0; for (const m of msgs) { if (m.id > lastId) lastId = m.id; if (m.from === 'admin') { bubble('admin', esc(m.text).replace(/\n/g, '<br>')); n++; } } return n; }
  function startPoll() {
    stopPoll();
    const tick = async () => {
      if (!convId) return;
      try {
        const r = await fetch(`${API}/poll?id=${encodeURIComponent(convId)}&after=${lastId}`);
        if (r.status === 404) { store.set(K_CONV, ''); convId = null; stopPoll(); return; }
        const j = await r.json();
        const n = addIncoming(j.messages || []);
        if (n && !opened) { badge.hidden = false; badge.textContent = String((+badge.textContent || 0) + n); }
        if (j.status !== convStatus) { convStatus = j.status; if (opened) chatFooter(); }
      } catch { /* retry next tick */ }
    };
    tick(); poll = setInterval(tick, 8000);
  }
  const stopPoll = () => { clearInterval(poll); poll = null; };
  function reset() { stopRecSilently(); pending.image = null; pending.voice = null; stopPoll(); convId = null; store.set(K_CONV, ''); transcript = []; saveTr(); log().innerHTML = ''; lastId = 0; greet(); askFooter(); }

  async function restoreConv() {
    try {
      const r = await fetch(`${API}/poll?id=${encodeURIComponent(convId)}&after=0`);
      if (!r.ok) { convId = null; store.set(K_CONV, ''); return false; }
      const j = await r.json(); convStatus = j.status; log().innerHTML = '';
      for (const m of j.messages) { lastId = Math.max(lastId, m.id); bubble(m.from === 'visitor' ? 'visitor' : m.from === 'admin' ? 'admin' : 'bot', m.voice ? voiceHtml(m.voice, m.text) : esc(m.text).replace(/\n/g, '<br>')); }
      chatFooter(); startPoll(); return true;
    } catch { return false; }
  }

  async function toggle(open) {
    opened = open ?? !opened;
    panel.hidden = !opened; fab.classList.toggle('open', opened);
    if (opened) {
      badge.hidden = true; badge.textContent = '';
      if (!log().children.length) { if (!(convId && await restoreConv())) { greet(); askFooter(); } }
      setTimeout(() => foot().querySelector('textarea')?.focus(), 50);
    }
  }
  fab.onclick = () => toggle();
  root.querySelector('.chesky-x').onclick = () => toggle(false);
  root.querySelector('.chesky-restart').onclick = () => { if (!convId || confirm('Start a new chat? Your current conversation with our team stays saved.')) reset(); };

  // resume from an emailed link (?chesky=<id>) or a stored conversation
  const q = new URLSearchParams(location.search).get('chesky');
  if (q && /^[A-Za-z0-9_-]{10,40}$/.test(q)) { convId = q; store.set(K_CONV, q); toggle(true); }
  else if (convId) startPoll();
  return { open: () => toggle(true) };
}
