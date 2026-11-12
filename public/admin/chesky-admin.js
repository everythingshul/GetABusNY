// Admin "Chesky" view: handoff inbox, unanswered questions to teach, and learned answers.
// Usage in admin.js:  import { renderChat } from '/admin/chesky-admin.js';
//   VIEWS.chesky = (el) => renderChat(el, { GET, POST, PUT, DEL, esc, toast, badge, table, modal, button, ago });
export async function renderChat(el, h) {
  const { GET, POST, PUT, DEL, esc, toast, badge, table, modal, button, ago } = h;
  let tab = 'conversations', selected = null;
  const fail = (e) => toast(e.message || String(e), true);

  const frame = () => {
    el.innerHTML = `<div class="toolbar"><div class="chips" id="cTabs"><button class="chip ${tab === 'conversations' ? 'on' : ''}" data-t="conversations">Conversations</button><button class="chip ${tab === 'teach' ? 'on' : ''}" data-t="teach">Teach Chesky</button></div></div><div id="cBody"></div>`;
    el.querySelector('#cTabs').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { tab = b.dataset.t; draw(); } };
  };
  const draw = async () => { frame(); try { await (tab === 'conversations' ? conversations() : teach()); } catch (e) { fail(e); } };

  // ---------- conversations ----------
  async function conversations() {
    const { conversations: rows } = await GET('/chesky');
    const body = el.querySelector('#cBody');
    body.innerHTML = `<div style="display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:16px;align-items:start" class="cLayout"><div class="panel" style="padding:8px">${rows.length ? rows.map((c) => `<div class="cRow" data-id="${esc(c.id)}" style="padding:10px;border-radius:8px;cursor:pointer;${c.id === selected ? 'background:#e3f1fa' : ''}"><div style="display:flex;justify-content:space-between;gap:6px"><b>${esc(c.name || c.email)}</b>${c.unread ? badge('new') : badge(c.status)}</div><div class="mut sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last)}</div><div class="mut sm">${ago(c.updatedAt)}</div></div>`).join('') : '<div class="empty">No conversations yet.</div>'}</div><div class="panel" id="cDetail"><p class="mut">Select a conversation.</p></div></div>`;
    body.querySelectorAll('.cRow').forEach((r) => r.onclick = () => { selected = r.dataset.id; conversations(); });
    if (selected) await detail(selected);
  }
  async function detail(id) {
    const c = await GET('/chesky/' + encodeURIComponent(id));
    const p = el.querySelector('#cDetail'); if (!p) return;
    p.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h3 style="margin:0">${esc(c.name || c.email)}</h3><div class="mut sm">${esc(c.email)}${c.page ? ' · ' + esc(c.page) : ''}</div></div><div style="display:flex;gap:6px">${button(c.status === 'closed' ? 'Reopen' : 'Close', 'sm', 'id="cToggle"')}${button('Delete', 'sm danger', 'id="cDel"')}</div></div>
    <div style="margin:14px 0;display:grid;gap:8px;max-height:380px;overflow:auto">${c.messages.map((m) => `<div style="justify-self:${m.from === 'admin' ? 'end' : 'start'};max-width:85%;background:${m.from === 'admin' ? '#e3f1fa' : m.from === 'bot' ? '#f3f6f9' : '#eef6d9'};padding:8px 12px;border-radius:10px"><div class="mut sm">${m.from === 'admin' ? 'You' : m.from === 'bot' ? 'Chesky' : esc(c.name || 'Visitor')} · ${ago(m.ts)}</div>${m.voice ? `<audio controls preload="none" src="${esc(m.voice.url)}" style="width:100%;max-width:280px;display:block;margin:4px 0"></audio><div class="mut sm">${m.voice.dur ? Math.round(m.voice.dur) + ' second voice note' : 'Voice note'}${m.text ? '. Transcript:' : ', no transcript available'}</div>` : ''}${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}</div>`).join('') || '<p class="mut">No messages.</p>'}</div>
    <form id="cReply"><label>Reply<textarea name="text" rows="3" required></textarea></label><label style="flex-direction:row;display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="cAlso"> Also teach Chesky this answer</label><div id="cTeachQ" hidden><label>Question this answers<input name="teachQ" placeholder="e.g. Do you run on Shabbos?"></label></div><p>${button('Send reply', 'primary')}</p></form>`;
    p.querySelector('#cToggle').onclick = async () => { try { await PUT('/chesky/' + id, { status: c.status === 'closed' ? 'open' : 'closed' }); conversations(); } catch (e) { fail(e); } };
    p.querySelector('#cDel').onclick = async () => { if (!confirm('Delete this conversation?')) return; try { await DEL('/chesky/' + id); selected = null; conversations(); } catch (e) { fail(e); } };
    p.querySelector('#cAlso').onchange = (e) => { p.querySelector('#cTeachQ').hidden = !e.target.checked; };
    p.querySelector('#cReply').onsubmit = async (e) => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
      try { const r = await POST(`/chesky/${id}/reply`, { text: fd.text, teach: p.querySelector('#cAlso').checked && fd.teachQ ? { q: fd.teachQ, a: fd.text } : undefined }); toast(r.emailed ? 'Reply sent' : 'Reply saved (email not delivered; visitor sees it in chat)'); conversations(); } catch (x) { fail(x); }
    };
  }

  // ---------- teach ----------
  const teachForm = (e = {}) => `<form id="tForm"><label>Question(s) that trigger this answer <span class="hint">one per line</span><textarea name="qs" rows="3" required>${esc((e.questions || []).join('\n'))}</textarea></label><label style="margin-top:10px">Answer<textarea name="r" rows="4" required>${esc(e.answer || '')}</textarea></label><p class="hint">Never put prices in an answer; pricing is always quoted by staff.</p></form>`;
  function teachModal(entry, drop) {
    modal({ title: entry?.id ? 'Edit taught answer' : 'Teach Chesky', body: teachForm(entry), small: true, footer: `<span class="sp"></span>${button(entry?.id ? 'Save' : 'Teach', 'primary', 'id="tSave"')}`, onMount(ov, close) {
      ov.querySelector('#tSave').onclick = async () => {
        const fd = Object.fromEntries(new FormData(ov.querySelector('#tForm')));
        const qs = String(fd.qs || '').split('\n').map((s) => s.trim()).filter(Boolean);
        try { await POST('/chesky/learn/teach', { id: entry?.id, qs, r: fd.r, drop: drop ? [drop] : [] }); close(); toast('Chesky learned it'); draw(); } catch (e) { fail(e); }
      };
    } });
  }
  async function teach() {
    const { unanswered, learned, stats } = await GET('/chesky/learn');
    const body = el.querySelector('#cBody');
    body.innerHTML = `<div class="panel"><h3>Couldn't answer (${unanswered.length})</h3><p class="mut sm">Questions visitors asked that Chesky declined or that got a thumbs-down. Teach the real answer and it won't miss it again.</p>${table([{ h: 'Question', f: (u) => esc(u.question) }, { h: 'Missed', f: (u) => u.miss, cls: 'r' }, { h: '👎', f: (u) => u.down, cls: 'r' }, { h: 'Last', f: (u) => ago(u.lastAt) }, { h: '', f: (u) => `<button class="btn sm primary" data-teach="${esc(u.key)}" data-q="${esc(u.question)}">Teach</button> <button class="btn sm" data-dismiss="${esc(u.key)}">Dismiss</button>` }], unanswered, { empty: 'Nothing waiting.' })}</div>
    <div class="panel"><h3>What Chesky knows (${learned.length}) ${button('+ Teach new answer', 'sm primary', 'id="tNew"')}</h3>${table([{ h: 'Questions', f: (l) => l.questions.map((q) => `<span class="badge b-b">${esc(q)}</span>`).join(' ') }, { h: 'Answer', f: (l) => esc(l.answer) }, { h: '👍/👎', f: (l) => `${stats[l.id]?.up || 0} / ${stats[l.id]?.down || 0}`, cls: 'r' }, { h: '', f: (l) => `<button class="btn sm" data-edit="${esc(l.id)}">Edit</button> <button class="btn sm danger" data-forget="${esc(l.id)}">Delete</button>` }], learned, { empty: 'Nothing taught yet.' })}</div>`;
    body.onclick = async (ev) => {
      const t = ev.target.closest('[data-teach]'), d = ev.target.closest('[data-dismiss]'), e = ev.target.closest('[data-edit]'), f = ev.target.closest('[data-forget]');
      try {
        if (t) teachModal({ questions: [t.dataset.q] }, t.dataset.teach);
        else if (d) { await DEL('/chesky/learn/unanswered/' + encodeURIComponent(d.dataset.dismiss)); teach(); }
        else if (e) teachModal(learned.find((l) => l.id === e.dataset.edit));
        else if (f && confirm('Delete this taught answer?')) { await POST('/chesky/learn/forget', { id: f.dataset.forget }); teach(); }
        else if (ev.target.closest('#tNew')) teachModal();
      } catch (x) { fail(x); }
    };
  }

  await draw();
}
