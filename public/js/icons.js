// Simple line icons. Deliberately no people anywhere on this site.
const P = {
  tent: '<path d="M3 20 12 4l9 16H3z"/><path d="M12 4v16M9 20l3-6 3 6"/>',
  flame: '<path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 2 2 2 0-3-1-5 0-7z"/><path d="M8 21h8M12 16v5"/>',
  building: '<path d="M4 21V9l8-5 8 5v12"/><path d="M9 21v-6h6v6M12 9v.01"/>',
  pin: '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  ring: '<circle cx="12" cy="14" r="6"/><path d="m9 5 3-2 3 2-3 3-3-3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  plane: '<path d="M10 14 3 11l1-2 7 1 5-6 2 1-3 7 5 3-1 2-6-2-4 5-2-1 3-5z"/>',
  bus: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M3 11h18M7 20v-3M17 20v-3"/><circle cx="7.5" cy="14" r=".6"/><circle cx="16.5" cy="14" r=".6"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
export const icon = (n) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.bus}</svg>`;

// first-party, cookie-less page-view counter (no IP stored)
export function beacon() {
  try {
    const sid = sessionStorage.gabSid || (sessionStorage.gabSid = Math.random().toString(36).slice(2) + Date.now().toString(36));
    const body = JSON.stringify({ p: location.pathname, r: document.referrer, s: sid });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/public/t', new Blob([body], { type: 'application/json' }));
    else fetch('/api/public/t', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
  } catch { /* analytics must never break the page */ }
}
export const fillIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
