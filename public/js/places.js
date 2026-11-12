// Google Places address suggestions for any <input>. The browser talks to our own server,
// which holds the Google key (so the key is never exposed). If Maps is not configured the
// input simply stays a normal text box.
let enabled = null;
const style = `.pl-list{position:absolute;z-index:1000;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1.5px solid var(--line,#dbe5ec);border-radius:10px;box-shadow:0 12px 30px rgba(16,34,47,.18);overflow:hidden;max-height:280px;overflow-y:auto}
.pl-item{padding:9px 12px;cursor:pointer;font-size:.92rem;line-height:1.3;color:#10222f}.pl-item small{display:block;color:#5a6e7d}
.pl-item:hover,.pl-item.on{background:#e3f1fa}.pl-foot{padding:4px 10px;font-size:.7rem;color:#8a99a5;text-align:right;border-top:1px solid #eef2f6}`;
function inject() { if (document.getElementById('pl-style')) return; const s = document.createElement('style'); s.id = 'pl-style'; s.textContent = style; document.head.append(s); }
const token = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

async function isOn() {
  if (enabled !== null) return enabled;
  try { enabled = !!(await (await fetch('/api/public/config')).json()).maps; } catch { enabled = false; }
  return enabled;
}

/** attachPlaces(input, { onPick({address, place_id, lat, lng, name}) }) → detach() */
export async function attachPlaces(input, { onPick, onClear } = {}) {
  if (!input || input._places || !(await isOn())) return () => {};
  input._places = true; inject();
  input.autocomplete = 'off';
  const wrap = document.createElement('div'); wrap.style.position = 'relative';
  input.parentNode.insertBefore(wrap, input); wrap.append(input);
  const list = document.createElement('div'); list.className = 'pl-list'; list.hidden = true; wrap.append(list);
  let st = token(), items = [], idx = -1, timer, seq = 0;
  const close = () => { list.hidden = true; idx = -1; };
  const render = () => {
    if (!items.length) return close();
    list.innerHTML = items.map((s, i) => `<div class="pl-item ${i === idx ? 'on' : ''}" data-i="${i}">${esc(s.main || s.text)}<small>${esc(s.secondary || '')}</small></div>`).join('') + '<div class="pl-foot">Powered by Google</div>';
    list.hidden = false;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  async function pick(s) {
    close(); input.value = s.text || s.main; input.dataset.placeId = s.place_id;
    try {
      const d = await (await fetch(`/api/public/places/details?id=${encodeURIComponent(s.place_id)}&st=${st}`)).json();
      if (d.address) { input.value = d.address; input.dataset.lat = d.lat; input.dataset.lng = d.lng; onPick?.({ address: d.address, place_id: d.place_id, lat: d.lat, lng: d.lng, name: d.name }); }
    } catch { onPick?.({ address: input.value, place_id: s.place_id }); }
    st = token(); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  input.addEventListener('input', () => {
    delete input.dataset.placeId; delete input.dataset.lat; delete input.dataset.lng; onClear?.();
    clearTimeout(timer); const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => {
      const my = ++seq;
      try { const r = await (await fetch(`/api/public/places/autocomplete?q=${encodeURIComponent(q)}&st=${st}`)).json(); if (my === seq) { items = r; idx = -1; render(); } } catch { close(); }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(items[idx]); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => { const it = e.target.closest('.pl-item'); if (it) { e.preventDefault(); pick(items[+it.dataset.i]); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return () => { wrap.replaceWith(input); input._places = false; };
}
export const attachAll = (root = document) => root.querySelectorAll('input[data-places]').forEach((i) => attachPlaces(i));
