// Home page banner slideshow.
// Images are fetched and painted as CSS backgrounds (no <img> tags), with an invisible shield on top that
// swallows right-click, drag, select and long-press. That stops casual saving on every browser.
// It cannot stop screenshots or someone reading the network tab. Nothing in a browser can.
export async function initBanner(el) {
  if (!el) return;
  const hero = el.closest('.hero');
  let data;
  try { const r = await fetch('/api/public/banner'); data = r.ok ? await r.json() : null; } catch { data = null; }
  const slides = (data && data.slides) || [];
  if (!slides.length) return; // clean navy hero with the flat vehicle illustration
  const secs = Math.max(3, Number(data.seconds) || 6);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.innerHTML = '<div class="bn-layer"></div><div class="bn-layer"></div><div class="bn-shade"></div><div class="bn-shield"></div>';
  const layers = [...el.querySelectorAll('.bn-layer')];
  const shield = el.querySelector('.bn-shield');
  const stop = (e) => { e.preventDefault(); return false; };
  for (const t of ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut']) { shield.addEventListener(t, stop); el.addEventListener(t, stop); }

  const urls = new Array(slides.length).fill(null);
  const load = async (i) => {
    if (urls[i]) return urls[i];
    try { const r = await fetch(slides[i].url); if (!r.ok) throw 0; urls[i] = URL.createObjectURL(await r.blob()); } catch { urls[i] = 'x'; }
    return urls[i];
  };
  const show = (url, layer) => { layers.forEach((l) => l.classList.remove('on')); layer.style.backgroundImage = `url("${url}")`; layer.classList.add('on'); };

  let i = 0, cur = 0, timer = null;
  const first = await load(0);
  if (first === 'x') return;
  show(first, layers[0]); hero && hero.classList.add('hasslides');
  if (slides.length < 2) return;
  load(1); // the rest load lazily, one ahead

  const next = async () => {
    const n = (i + 1) % slides.length;
    const u = await load(n);
    if (u !== 'x') {
      i = n; cur = 1 - cur;
      const layer = layers[cur];
      if (reduce) { layer.style.transition = 'none'; layers[1 - cur].style.transition = 'none'; }
      show(u, layer);
    } else i = n;
    load((i + 1) % slides.length);
  };
  const start = () => { if (!timer) timer = setInterval(next, secs * 1000); };
  const pause = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : start()));
  start();
}
