// Touch/mouse signature pad on a <canvas>. get() returns a PNG data URL (transparent background) or null if blank.
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const w = canvas.clientWidth || 500, h = canvas.clientHeight || 160;
  canvas.width = w * ratio; canvas.height = h * ratio; ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1b26';
  let drawing = false, dirty = false, last = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 7); ctx.fill(); dirty = true; e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return {
    clear() { ctx.clearRect(0, 0, w, h); dirty = false; },
    get: () => (dirty ? canvas.toDataURL('image/png') : null),
  };
}
