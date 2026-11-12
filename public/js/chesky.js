// Chesky: a floating help widget. Default mode asks the real AI (scoped to
// this site) instant questions; "Talk to a person" hands off to a real human
// conversation (polled for replies), with an optional voice note.
const API = '/api/public/chesky';
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toast = (m) => { const t = document.createElement('div'); t.textContent = m; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#232323;color:#fff;padding:10px 16px;border-radius:10px;font:600 .88rem Heebo,system-ui,sans-serif;z-index:1100;max-width:90vw'; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };
const safe = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
const Chesky = (() => {
  const STORAGE_CONV = 'chesky_conv_id';
  const STORAGE_NUDGE = 'chesky_nudge_seen';
  const STORAGE_TRANSCRIPT = 'chesky_transcript';
  const MAX_RECORD_SECONDS = 60;
  const LIVE_BAR_COUNT = 27;

  let open = false;
  let convId = safe.get(STORAGE_CONV) || null;
  let siteName = 'Get A Bus NY';
  let convStatus = 'open';
  let pollTimer = null;
  let lastMsgId = 0;
  let transcript = [];
  try { transcript = JSON.parse(sessionStorage.getItem(STORAGE_TRANSCRIPT) || '[]'); } catch (e) { transcript = []; }
  let busy = false;
  let activeAudio = null;
  let pendingImage = null; // {blob, mime, url} - attached, not yet sent
  let pendingVoice = null; // {blob, mime, dur, peaks, localUrl} - attached, not yet sent

  // Recording state
  let recorder = null;
  let recordedChunks = [];
  let recordStart = 0;
  let recordPeaks = [];
  let liveBars = [];
  let recordStream = null;
  let recordTimer = null;
  let recordAutoStop = null;
  let recordCancelled = false;
  let recordMode = 'ask'; // 'ask' | 'handoff' - which footer to restore when done

  const quickActions = () => ['Request a quote'];
  const STARTERS = ['Which bus fits my group?', 'What are your hours?', 'Do you do Shabbatons and Kehila trips?'];
  const MIC_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 11z"/></svg>';
  const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const RESTART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  const REMOVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
  const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const THUMB_UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zm0 0 4.5-8a2 2 0 0 1 2.3 2.8L12.5 10H18a2 2 0 0 1 1.94 2.5l-1.5 6A2 2 0 0 1 16.5 20H9a2 2 0 0 1-2-2"/></svg>';
  const THUMB_DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3zm0 0-4.5 8a2 2 0 0 1-2.3-2.8L11.5 14H6a2 2 0 0 1-1.94-2.5l1.5-6A2 2 0 0 1 7.5 4H15a2 2 0 0 1 2 2"/></svg>';

  // Chat activity for the admin Analytics page - what happened (opened,
  // asked, got a post made...), never what was typed or said.
  function report() { /* chat activity is not tracked on this site */ }

  async function req(path, body) {
    const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  async function upload(kind, blob, mime, extra = {}) {
    const qs = new URLSearchParams({ kind, ...(extra.dur ? { dur: String(extra.dur) } : {}), ...(extra.peaks?.length ? { peaks: extra.peaks.join(',') } : {}) });
    const r = await fetch(`${API}/media?${qs}`, { method: 'POST', headers: { 'content-type': mime }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The upload did not work. Please try again.');
    return j.id;
  }

  function saveTranscript() {
    try { sessionStorage.setItem(STORAGE_TRANSCRIPT, JSON.stringify(transcript.slice(-16))); } catch (e) { /* ignore */ }
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
  }

  // Enter sends the message; Ctrl+Enter (or Cmd+Enter) inserts a newline
  // instead. A plain textarea has no default action bound to Ctrl+Enter (it's
  // not "same as Enter" - browsers just do nothing with it), so the newline
  // has to be inserted by hand rather than left to fall through. Also grows
  // the box as lines are added, since it starts at a single row and the CSS
  // has no auto-resize of its own.
  function wireEnterToSend(textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const { selectionStart, selectionEnd } = textarea;
        textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      textarea.form?.requestSubmit();
    });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }

  function scrollLog() {
    const log = document.getElementById('cheskyLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // -- Voice note bubble: a little play/pause + waveform player, with the
  // transcript (if any) shown as a caption underneath - "a recording plus
  // the transcription," not just one or the other.
  function voiceBubbleHtml(voice, transcriptText) {
    const peaks = (voice.peaks && voice.peaks.length) ? voice.peaks : Array.from({ length: 24 }, () => 25 + Math.round(Math.random() * 45));
    const bars = peaks.map((p) => `<i style="height:${Math.max(15, Math.min(100, p))}%"></i>`).join('');
    // Built as one unbroken line, not an indented multi-line template - the
    // bubble has white-space:pre-wrap, so stray newlines/indentation here
    // would render as real blank lines inside the bubble.
    const transcriptHtml = transcriptText ? `<div class="chesky-voice-transcript">${escapeHtml(transcriptText)}</div>` : '';
    return `<div class="chesky-voice" data-src="${escapeHtml(voice.url)}"><button type="button" class="chesky-vp-btn" aria-label="Play voice note">&#9654;</button><div class="chesky-vp-wave">${bars}</div><span class="chesky-vp-dur">${fmtDur(voice.dur)}</span></div>${transcriptHtml}`;
  }

  function wireVoicePlayers(root) {
    root.querySelectorAll('.chesky-voice:not([data-wired])').forEach((voiceEl) => {
      voiceEl.dataset.wired = '1';
      const btn = voiceEl.querySelector('.chesky-vp-btn');
      const bars = voiceEl.querySelectorAll('.chesky-vp-wave i');
      const audio = new Audio(voiceEl.dataset.src);
      btn.addEventListener('click', () => {
        if (audio.paused) {
          if (activeAudio && activeAudio !== audio) activeAudio.pause();
          activeAudio = audio;
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      });
      audio.addEventListener('play', () => { btn.innerHTML = '&#10073;&#10073;'; });
      audio.addEventListener('pause', () => { btn.innerHTML = '&#9654;'; });
      audio.addEventListener('ended', () => { bars.forEach((b) => b.classList.remove('on')); });
      audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const onCount = Math.round((audio.currentTime / audio.duration) * bars.length);
        bars.forEach((b, i) => b.classList.toggle('on', i < onCount));
      });
    });
  }

  function addCaption(node, text) {
    if (!node || !text) return;
    node.querySelector('.chesky-bubble')?.insertAdjacentHTML('beforeend', `<div class="chesky-voice-transcript">${escapeHtml(text)}</div>`);
  }

  function bubble(from, html, extraHtml = '') {
    const log = document.getElementById('cheskyLog');
    if (!log) return null;
    const who = from === 'visitor' ? '' : `<div class="chesky-msg-who">${from === 'admin' ? 'Team' : 'Chesky'}</div>`;
    const node = el(`<div class="chesky-msg from-${from}">${who}<div class="chesky-bubble">${html}</div>${extraHtml}</div>`);
    log.appendChild(node);
    wireVoicePlayers(log);
    scrollLog();
    return node;
  }

  function showTyping() {
    const log = document.getElementById('cheskyLog');
    if (!log) return null;
    const node = el('<div class="chesky-msg from-bot"><div class="chesky-typing"><span></span><span></span><span></span></div></div>');
    log.appendChild(node);
    scrollLog();
    return node;
  }

  // Markup only - feedbackRow() used to build+wire a detached node and
  // return its outerHTML, but serializing to a string and re-parsing it (as
  // bubble() does to embed it in the message) drops DOM event listeners
  // entirely, so the thumbs buttons never actually did anything. Listeners
  // are now wired separately, by wireFeedbackRow(), on the real inserted node.
  function feedbackRowHtml() {
    return `
      <div class="chesky-fb">
        <button type="button" data-fb="up" title="Helpful">${THUMB_UP_ICON}</button>
        <button type="button" data-fb="down" title="Not helpful">${THUMB_DOWN_ICON}</button>
      </div>
    `;
  }

  function wireFeedbackRow(bubbleNode, question, entryId) {
    const row = bubbleNode?.querySelector('.chesky-fb');
    if (!row) return;
    row.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('button').forEach((b) => b.classList.remove('picked'));
        btn.classList.add('picked');
        report(btn.dataset.fb);
        req('/log', { type: btn.dataset.fb, q: question, entry: entryId }).catch(() => {});
      });
    });
  }

  // chesky-starter-row (on top of chesky-chips, which just styles the row)
  // marks this specific row as the one-time opening suggestions, so ask()
  // can clear it on first use without also wiping later chip rows
  // (post-reference/post-created buttons) that are meant to stay in the log.
  function chipsHtml() {
    const items = [...quickActions(), ...STARTERS];
    return `<div class="chesky-chips chesky-starter-row">${items.map((s) => `<button type="button" class="chesky-chip">${escapeHtml(s)}</button>`).join('')}</div>`;
  }

  function displayBotReply(question, result) {
    const node = bubble('bot', escapeHtml(result.reply).replace(/\n/g, '<br>'), feedbackRowHtml());
    wireFeedbackRow(node, question, result.entryId);
    transcript.push({ role: 'assistant', text: result.reply });
    saveTranscript();
    if (result.submitted?.reference) { report('quote'); bubble('bot', `Your reference number is <b>${escapeHtml(result.submitted.reference)}</b>. We will be in touch.`); }
    if (result.offTopic) report('miss');
    if (result.offTopic) {
      const log = document.getElementById('cheskyLog');
      log.appendChild(el(`<div style="text-align:center"><button type="button" class="chesky-talk-human" id="cheskyTalkHumanInline">Talk to a real person &rarr;</button></div>`));
      document.getElementById('cheskyTalkHumanInline').addEventListener('click', showHandoffForm);
      scrollLog();
    }
  }

  async function ask(question) {
    const image = pendingImage;
    const voice = pendingVoice;
    if (busy || (!question.trim() && !image && !voice)) return;
    busy = true;
    report('send', { x: { photo: image ? 1 : 0, voice: voice ? 1 : 0 } });
    document.querySelectorAll('.chesky-starter-row').forEach((c) => c.remove());
    clearPendingAttachments();
    renderPendingAttachments();

    let attachmentsHtml = '';
    if (voice) attachmentsHtml += voiceBubbleHtml({ url: voice.localUrl, dur: voice.dur, peaks: voice.peaks }, '');
    if (image) attachmentsHtml += `<img class="chesky-sent-photo" src="${escapeHtml(image.url)}" alt="">`;
    const bubbleNode = question.trim() ? bubble('visitor', escapeHtml(question), attachmentsHtml) : bubble('visitor', attachmentsHtml);

    const typingNode = showTyping();
    try {
      const body = { question, transcript, page: location.pathname };
      if (image) body.image_id = await upload('image', image.blob, image.mime);
      if (voice) body.voice_id = await upload('voice', voice.blob, voice.mime, { dur: voice.dur, peaks: voice.peaks });
      const result = await req('/ask', body);
      if (voice && result.voiceTranscript) addCaption(bubbleNode, result.voiceTranscript);
      const historyText = question.trim() || result.voiceTranscript || (image ? '(sent a photo)' : '');
      transcript.push({ role: 'user', text: historyText });
      saveTranscript();
      typingNode?.remove();
      displayBotReply(historyText, result);
    } catch (e) {
      typingNode?.remove();
      bubble('bot', escapeHtml(e.message || 'Sorry, something went wrong. Please try again, or talk to our team below.'));
    } finally {
      busy = false;
    }
  }

  // -- Photo/voice attach: a camera button and the mic button both just
  // attach, shown as preview chips above the composer until Send is
  // pressed - sent together with whatever's typed, or alone, or together
  // with each other ("send me a picture and a voice note" is one Send tap).
  // Nothing is uploaded just for attaching it - picking a photo or
  // recording a note you don't end up sending never touches the server.
  function renderPendingAttachments() {
    const host = document.getElementById('cheskyImagePreview');
    if (!host) return;
    if (!pendingImage && !pendingVoice) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    host.innerHTML = `
      ${pendingImage ? `
        <div class="chesky-img-chip" data-attachment="image">
          <img src="${escapeHtml(pendingImage.url)}" alt="">
          <button type="button" class="chesky-img-chip-remove" aria-label="Remove photo">${REMOVE_ICON}</button>
        </div>` : ''}
      ${pendingVoice ? `
        <div class="chesky-voice-chip" data-attachment="voice">
          ${MIC_ICON}
          <span>${fmtDur(pendingVoice.dur)}</span>
          <button type="button" class="chesky-voice-chip-remove" aria-label="Remove voice note">${REMOVE_ICON}</button>
        </div>` : ''}
    `;
    host.querySelector('.chesky-img-chip-remove')?.addEventListener('click', () => { pendingImage = null; renderPendingAttachments(); });
    host.querySelector('.chesky-voice-chip-remove')?.addEventListener('click', () => { pendingVoice = null; renderPendingAttachments(); });
  }

  function clearPendingAttachments() {
    pendingImage = null;
    pendingVoice = null;
  }

  async function handlePickedImage(file) {
    if (!file) return;
    if (!ALLOWED_IMAGE_MIME.has(file.type)) return toast('Please choose a JPG, PNG, or WEBP photo.');
    try {
      let blob = file;
      if (file.size > 3.5 * 1024 * 1024) { // big phone photos are shrunk first so they upload fast
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
      }
      if (!blob || blob.size > MAX_IMAGE_BYTES) return toast('That photo is too large - please use one under 6MB.');
      pendingImage = { blob, mime: blob.type || file.type, url: URL.createObjectURL(blob) };
      renderPendingAttachments();
    } catch (e) {
      toast('Could not use that photo - please try another.');
    }
  }

  function micAvailable() {
    return !!(navigator.mediaDevices && window.MediaRecorder);
  }

  function renderAskFooter() {
    const foot = document.getElementById('cheskyFoot');
    foot.innerHTML = `
      <div id="cheskyImagePreview" class="chesky-img-preview" style="display:none"></div>
      <form class="chesky-form" id="cheskyAskForm">
        <div class="chesky-row">
          <button type="button" class="chesky-camera-btn" id="cheskyCameraBtn" title="Attach a photo">${CAMERA_ICON}</button>
          <button type="button" class="chesky-mic-btn" id="cheskyMicBtn" title="Attach a voice note">${MIC_ICON}</button>
          <textarea name="q" rows="1" placeholder="Ask a question..."></textarea>
          <button type="submit">Send</button>
        </div>
        <input type="file" id="cheskyImageInput" accept="image/png,image/jpeg,image/webp" style="display:none">
      </form>
      <div style="text-align:center;padding:6px 0 10px"><button type="button" class="chesky-talk-human" id="cheskyTalkHumanBtn">Talk to a real person &rarr;</button></div>
    `;
    if (!micAvailable()) document.getElementById('cheskyMicBtn').style.display = 'none';
    renderPendingAttachments();
    wireEnterToSend(document.getElementById('cheskyAskForm').q);
    document.getElementById('cheskyAskForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = e.target.q;
      const q = ta.value;
      ta.value = '';
      ta.style.height = '';
      ask(q);
    });
    document.getElementById('cheskyMicBtn').addEventListener('click', () => startRecording('ask'));
    document.getElementById('cheskyCameraBtn').addEventListener('click', () => document.getElementById('cheskyImageInput').click());
    document.getElementById('cheskyImageInput').addEventListener('change', (e) => {
      handlePickedImage(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('cheskyTalkHumanBtn').addEventListener('click', showHandoffForm);
  }

  function showHandoffForm() {
    const foot = document.getElementById('cheskyFoot');
    foot.innerHTML = `
      <form class="chesky-handoff" id="cheskyHandoffForm">
        <div class="chesky-handoff-head">
          <span>Talk to a real person</span>
          <button type="button" class="chesky-handoff-close" id="cheskyHandoffClose" aria-label="Cancel">&#10005;</button>
        </div>
        <div class="form-row"><label>Your name</label><input name="name" autocomplete="name"></div>
        <div class="form-row"><label>Email or reply address *</label><input name="email" type="email" required autocomplete="email"></div>
        <div class="form-row"><label>Message *</label><textarea name="message" rows="2" required></textarea></div>
        <button type="submit">Start conversation</button>
      </form>
    `;
    document.getElementById('cheskyHandoffClose').addEventListener('click', renderAskFooter);
    document.getElementById('cheskyHandoffForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const result = await req('/handoff', {
          name: fd.name, email: fd.email, message: fd.message, page: location.pathname,
          transcript: transcript.map((m) => ({ role: m.role === 'user' ? 'customer' : 'bot', text: m.text })),
        });
        convId = result.id;
        safe.set(STORAGE_CONV, convId);
        report('handoff');
        bubble('bot', "Thanks! A real person on our team will reply here soon - feel free to keep chatting. Our office is closed Saturday.");
        lastMsgId = result.baselineId || 0;
        enterHandoffMode();
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    });
  }

  function renderHandoffFooter() {
    const foot = document.getElementById('cheskyFoot');
    const disabled = convStatus === 'closed';
    foot.innerHTML = `
      ${disabled ? '<p class="hint" style="padding:8px 10px">This conversation has ended.</p>' : ''}
      <form class="chesky-form" id="cheskySendForm">
        <div class="chesky-row">
          <button type="button" class="chesky-mic-btn" id="cheskyMicBtn" title="Record a voice note">${MIC_ICON}</button>
          <textarea name="t" rows="1" placeholder="Type a message..." ${disabled ? 'disabled' : ''}></textarea>
          <button type="submit" ${disabled ? 'disabled' : ''}>Send</button>
        </div>
      </form>
    `;
    if (!micAvailable()) document.getElementById('cheskyMicBtn').style.display = 'none';
    if (!disabled) wireEnterToSend(document.getElementById('cheskySendForm').t);
    document.getElementById('cheskySendForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ta = e.target.t;
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      ta.style.height = '';
      bubble('visitor', escapeHtml(text));
      try {
        const result = await req('/send', { id: convId, text });
        if (result.lastId > lastMsgId) lastMsgId = result.lastId;
      } catch (err) { toast(err.message); }
    });
    document.getElementById('cheskyMicBtn').addEventListener('click', () => startRecording('handoff'));
  }

  function restoreFooter() {
    if (recordMode === 'handoff') renderHandoffFooter();
    else renderAskFooter();
  }

  // -- Recording toolbar: a live red dot + timer + scrolling waveform +
  // cancel/send, replacing the normal composer while recording.
  function renderRecordingToolbar() {
    const foot = document.getElementById('cheskyFoot');
    foot.innerHTML = `
      <div class="chesky-rec-row">
        <span class="chesky-rec-dot"></span>
        <span class="chesky-rec-time">0:00</span>
        <div class="chesky-rec-wave" id="cheskyRecWave"></div>
        <button type="button" class="chesky-rec-btn chesky-rec-cancel" id="cheskyRecCancel" aria-label="Cancel">&#10005;</button>
        <button type="button" class="chesky-rec-btn chesky-rec-send" id="cheskyRecSend" aria-label="Send">&#10148;</button>
      </div>
    `;
    document.getElementById('cheskyRecCancel').addEventListener('click', () => stopRecording(true));
    document.getElementById('cheskyRecSend').addEventListener('click', () => stopRecording(false));
  }

  function paintLiveWave() {
    const waveEl = document.getElementById('cheskyRecWave');
    if (waveEl) waveEl.innerHTML = liveBars.map((b) => `<i style="height:${Math.max(10, b)}%"></i>`).join('');
  }

  async function startRecording(mode) {
    if (recorder && recorder.state === 'recording') return;
    recordMode = mode;
    try {
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('Microphone access was denied.');
      return;
    }
    recordedChunks = [];
    recordPeaks = [];
    liveBars = [];
    recordCancelled = false;
    recordStart = Date.now();
    const wanted = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(recordStream, wanted ? { mimeType: wanted } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
    recorder.onstop = onRecordingStop;

    renderRecordingToolbar();
    recordTimer = setInterval(() => {
      const timeEl = document.querySelector('.chesky-rec-time');
      if (timeEl) timeEl.textContent = fmtDur((Date.now() - recordStart) / 1000);
    }, 250);
    recordAutoStop = setTimeout(() => stopRecording(false), MAX_RECORD_SECONDS * 1000);

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(recordStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        if (!recorder || recorder.state !== 'recording') return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        const level = Math.round((avg / 255) * 100);
        recordPeaks.push(level);
        liveBars.push(level);
        if (liveBars.length > LIVE_BAR_COUNT) liveBars.shift();
        paintLiveWave();
        setTimeout(sample, 220);
      };
      sample();
    } catch (e) { /* peaks are cosmetic - fine without them */ }

    recorder.start();
  }

  function stopRecording(cancelled) {
    if (!recorder || recorder.state !== 'recording') return;
    recordCancelled = cancelled;
    recorder.stop();
  }

  function recordedBlob() {
    const mime = recorder?.mimeType || recordedChunks[0]?.type || 'audio/webm';
    const blob = new Blob(recordedChunks, { type: mime });
    return { blob, mime: mime.split(';')[0] || 'audio/webm', localUrl: URL.createObjectURL(blob) };
  }

  async function onRecordingStop() {
    clearInterval(recordTimer);
    clearTimeout(recordAutoStop);
    recordStream?.getTracks().forEach((t) => t.stop());

    const dur = (Date.now() - recordStart) / 1000;
    const isUsable = !recordCancelled && dur >= 0.6 && recordedChunks.length;
    const mode = recordMode;

    if (isUsable && mode === 'ask') {
      // Attach-and-hold, same idea as a photo - lets a voice note and a
      // photo (and/or typed text) all go out together in one message, so
      // "send me a picture and a voice note of what you want to sell" is
      // one Send tap, not two separate messages.
      const { blob, localUrl, mime } = recordedBlob();
      pendingVoice = { blob, mime, dur, peaks: recordPeaks, localUrl };
      restoreFooter();
      return;
    }

    restoreFooter();
    if (!isUsable) return;

    // Handoff mode (a real human conversation) still sends a voice note
    // immediately - there's no "compose and attach" step in a live
    // back-and-forth with a person.
    const { blob, localUrl, mime } = recordedBlob();
    const node = bubble('visitor', voiceBubbleHtml({ url: localUrl, dur, peaks: recordPeaks }, ''));
    try {
      const voiceId = await upload('voice', blob, mime, { dur, peaks: recordPeaks });
      const result = await req('/send', { id: convId, voice_id: voiceId });
      if (result.lastId > lastMsgId) lastMsgId = result.lastId;
      addCaption(node, result.transcript);
    } catch (e) { toast('Could not send the voice note.'); }
  }

  function enterHandoffMode() {
    renderHandoffFooter();
    startPolling();
  }

  function appendIncoming(messages) {
    messages.forEach((m) => {
      if (m.id > lastMsgId) lastMsgId = m.id;
      const content = m.voice ? voiceBubbleHtml(m.voice, m.text) : escapeHtml(m.text || '').replace(/\n/g, '<br>');
      bubble(m.from, content);
    });
  }

  function startPolling() {
    stopPolling();
    const tick = async () => {
      if (!convId) return;
      try {
        // lastMsgId only ever moves forward inside appendIncoming (once the
        // messages are actually on screen) - while the panel is closed the
        // log doesn't exist yet, so this intentionally keeps re-fetching
        // from the same baseline rather than silently marking unseen
        // messages as "seen" before the visitor ever had a chance to see them.
        const pr = await fetch(`${API}/poll?id=${encodeURIComponent(convId)}&after=${lastMsgId}`);
        if (pr.status === 404) { forgetConversation(); return; }
        const result = await pr.json();
        if (document.getElementById('cheskyLog')) {
          if (result.messages.length) appendIncoming(result.messages);
        } else if (!open) {
          const fromOthers = result.messages.filter((m) => m.from !== 'visitor');
          showUnreadBadge(fromOthers.length);
        }
        if (result.status !== convStatus) { convStatus = result.status; if (open) renderHandoffFooter(); }
      } catch (e) { /* transient - keep polling */ }
    };
    tick();
    pollTimer = setInterval(tick, open ? 4000 : 20000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  function forgetConversation() { stopPolling(); convId = null; convStatus = 'open'; lastMsgId = 0; safe.del(STORAGE_CONV); }

  // n is the total unseen count (not a delta) - each closed-state poll
  // re-fetches the same backlog, so this always replaces rather than adds.
  function showUnreadBadge(n) {
    const fab = document.getElementById('cheskyFab');
    if (!fab) return;
    let badge = fab.querySelector('.chesky-unread');
    if (!n) { badge?.remove(); return; }
    if (!badge) { badge = el('<span class="chesky-unread"></span>'); fab.appendChild(badge); }
    badge.textContent = n > 9 ? '9+' : String(n);
  }

  // Forgets the current conversation (AI chat and any human handoff alike)
  // and rebuilds the panel fresh, same as a first-time visitor would see it.
  function startOver() {
    report('restart');
    stopPolling();
    activeAudio?.pause();
    clearPendingAttachments();
    transcript = [];
    saveTranscript();
    convId = null;
    convStatus = 'open';
    lastMsgId = 0;
    safe.del(STORAGE_CONV);
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById('cheskyPanel');
    panel.innerHTML = `
      <div class="chesky-head">
        <img src="/img/chesky.svg" alt="">
        <div><strong>Chesky</strong><span>${escapeHtml(siteName)}</span></div>
        <button type="button" class="chesky-restart-btn" id="cheskyRestartBtn" title="Start over" aria-label="Start over">${RESTART_ICON}</button>
      </div>
      <div class="chesky-log" id="cheskyLog"></div>
      <div id="cheskyFoot"></div>
    `;
    document.getElementById('cheskyRestartBtn').addEventListener('click', startOver);
    bubble('bot', "Hi, I'm Chesky! Ask me anything about our buses, getting a quote, or how booking works.");
    document.getElementById('cheskyLog').appendChild(el(chipsHtml()));
    document.querySelectorAll('.chesky-chip').forEach((chip) => chip.addEventListener('click', () => ask(chip.textContent)));
    if (convId) enterHandoffMode();
    else renderAskFooter();
  }

  function togglePanel(forceOpen) {
    open = forceOpen !== undefined ? forceOpen : !open;
    document.getElementById('cheskyFab').classList.toggle('open', open);
    document.getElementById('cheskyPanel').classList.toggle('open', open);
    document.getElementById('cheskyNudge').classList.remove('show');
    safe.set(STORAGE_NUDGE, '1');
    // renderPanel() (via enterHandoffMode) already starts polling at the
    // right cadence the first time the log is created - calling it again
    // right after would fire a second concurrent tick before the first one's
    // lastMsgId update lands, double-appending the whole history.
    const logExisted = !!document.getElementById('cheskyLog');
    if (open) {
      report('open');
      if (!logExisted) renderPanel();
      document.getElementById('cheskyFab').querySelector('.chesky-unread')?.remove();
      scrollLog();
    }
    if (convId && logExisted) startPolling();
  }

  function init(config = {}) {
    if (config.siteName) siteName = config.siteName;
    if (document.getElementById('cheskyFab')) return;
    if (!document.querySelector('link[href="/css/chesky.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/css/chesky.css' }));
    const root = document.createElement('div'); root.id = 'chesky-root'; document.body.appendChild(root);
    root.appendChild(el(`
      <button class="chesky-fab" id="cheskyFab" aria-label="Chat with Chesky">
        <img src="/img/chesky.svg" alt="">
        <span class="chesky-close-ico">&times;</span>
      </button>
    `));
    root.appendChild(el(`
      <div class="chesky-nudge" id="cheskyNudge">
        Hi! I'm Chesky - ask me anything about renting a bus.
        <button type="button" aria-label="Dismiss">&times;</button>
      </div>
    `));
    root.appendChild(el('<div class="chesky-panel" id="cheskyPanel"></div>'));

    document.getElementById('cheskyFab').addEventListener('click', () => togglePanel());
    document.getElementById('cheskyNudge').addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') { document.getElementById('cheskyNudge').classList.remove('show'); safe.set(STORAGE_NUDGE, '1'); return; }
      togglePanel(true);
    });

    if (!safe.get(STORAGE_NUDGE)) {
      setTimeout(() => { if (!open) document.getElementById('cheskyNudge').classList.add('show'); }, 4000);
    }
    if (convId) startPolling();
  }

  return { init };
})();

export function initChesky(config = {}) {
  const go = () => Chesky.init({ siteName: config.siteName || 'Get A Bus NY' });
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  const q = new URLSearchParams(location.search).get('chesky');
  if (q && /^[A-Za-z0-9_-]{10,40}$/.test(q)) { safe.set('chesky_conv_id', q); setTimeout(() => document.getElementById('cheskyFab')?.click(), 400); }
}
