// Chesky widget (ported from JListings): AI chat first, "talk to a real person" handoff second.
// Usage: import { initChesky } from '/js/chesky.js'; initChesky({ name: 'Chesky', phone: '+1…' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const API = '/api/public/chesky';
const K_CONV = 'chesky_conv_id', K_TR = 'chesky_transcript';
const UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/></svg>';
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

  const root = el(`<div id="chesky-root"><button class="chesky-fab" aria-label="Chat with ${esc(name)}"><img src="/img/chesky.svg" alt=""><span class="chesky-close-ico">&times;</span><span class="chesky-unread" hidden></span></button>
  <section class="chesky-panel" role="dialog" aria-label="Chat with ${esc(name)}" hidden><header class="chesky-head"><img src="/img/chesky.svg" alt=""><div><b>${esc(name)}</b><small>Get A Bus NY assistant · a person confirms every quote</small></div><button class="chesky-restart" title="Start over" aria-label="Start over">&#8635;</button><button class="chesky-x" aria-label="Close">&times;</button></header>
  <div class="chesky-log" id="cheskyLog" aria-live="polite"></div><div class="chesky-foot" id="cheskyFoot"></div></section></div>`);
  document.body.append(root);
  const fab = root.querySelector('.chesky-fab'), panel = root.querySelector('.chesky-panel'), badge = root.querySelector('.chesky-unread');
  const log = () => root.querySelector('#cheskyLog'), foot = () => root.querySelector('#cheskyFoot');
  const scroll = () => { log().scrollTop = log().scrollHeight; };

  function bubble(from, html, extra = '') {
    const n = el(`<div class="chesky-msg from-${from}">${from === 'visitor' ? '' : `<div class="chesky-msg-who">${from === 'admin' ? 'Team' : esc(name)}</div>`}<div class="chesky-bubble">${html}</div>${extra}</div>`);
    log().append(n); scroll(); return n;
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

  // --- AI mode ---
  function askFooter() {
    foot().innerHTML = `<form class="chesky-form" id="cAsk"><textarea name="q" rows="1" placeholder="Ask a question or start a quote…" maxlength="1500"></textarea><button type="submit">Send</button></form>
    <div class="chesky-human"><button type="button" id="cHuman">Talk to a real person &rarr;</button></div>`;
    const f = foot().querySelector('#cAsk');
    wireTextarea(f.q);
    f.onsubmit = (e) => { e.preventDefault(); const q = f.q.value; f.q.value = ''; f.q.style.height = ''; ask(q); };
    foot().querySelector('#cHuman').onclick = handoffForm;
  }
  async function ask(q) {
    q = q.trim(); if (!q || busy) return; busy = true;
    log().querySelectorAll('.chesky-starters').forEach((n) => n.remove());
    bubble('visitor', esc(q));
    const t = typing();
    try {
      const r = await req('/ask', { question: q, transcript, page: location.pathname });
      transcript.push({ role: 'user', text: q }, { role: 'assistant', text: r.reply }); saveTr();
      t.remove();
      const n = bubble('bot', esc(r.reply).replace(/\n/g, '<br>'), `<div class="chesky-fb"><button data-fb="up" title="Helpful">${UP}</button><button data-fb="down" title="Not helpful">${DOWN}</button></div>`);
      n.querySelectorAll('.chesky-fb button').forEach((b) => b.onclick = () => { n.querySelectorAll('.chesky-fb button').forEach((x) => x.classList.remove('picked')); b.classList.add('picked'); req('/log', { type: b.dataset.fb, q, entry: r.entryId }).catch(() => {}); });
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
    const closed = convStatus === 'closed';
    foot().innerHTML = `${closed ? '<p class="chesky-note">This conversation has ended.</p>' : ''}<form class="chesky-form" id="cSend"><textarea name="t" rows="1" placeholder="Type a message…" ${closed ? 'disabled' : ''}></textarea><button ${closed ? 'disabled' : ''}>Send</button></form><div class="chesky-human"><button type="button" id="cNew">Start a new chat</button></div>`;
    const f = foot().querySelector('#cSend'); wireTextarea(f.t);
    foot().querySelector('#cNew').onclick = reset;
    f.onsubmit = async (e) => { e.preventDefault(); const t = f.t.value.trim(); if (!t) return; f.t.value = ''; f.t.style.height = ''; bubble('visitor', esc(t)); try { const r = await req('/send', { id: convId, text: t }); if (r.lastId > lastId) lastId = r.lastId; } catch (err) { bubble('bot', esc(err.message)); } };
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
  function reset() { stopPoll(); convId = null; store.set(K_CONV, ''); transcript = []; saveTr(); log().innerHTML = ''; lastId = 0; greet(); askFooter(); }

  async function restoreConv() {
    try {
      const r = await fetch(`${API}/poll?id=${encodeURIComponent(convId)}&after=0`);
      if (!r.ok) { convId = null; store.set(K_CONV, ''); return false; }
      const j = await r.json(); convStatus = j.status; log().innerHTML = '';
      for (const m of j.messages) { lastId = Math.max(lastId, m.id); bubble(m.from === 'visitor' ? 'visitor' : m.from === 'admin' ? 'admin' : 'bot', esc(m.text).replace(/\n/g, '<br>')); }
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
