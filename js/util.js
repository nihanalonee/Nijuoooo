/* OMNILIFE: THE SYNDICATE - core utilities */

// Deterministic-enough RNG (mulberry32) — the world engine stays seeded
// per save so reloads don't re-roll history.
let RNG_STATE = Date.now() >>> 0;

export function seedRng(n) {
  RNG_STATE = n >>> 0 || 123456789;
}
export function rng() {
  // mulberry32
  RNG_STATE = (RNG_STATE + 0x6d2b79f5) | 0;
  let t = RNG_STATE;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rand = (a = 0, b = 1) => a + rng() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(rng() * arr.length)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
export const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

export function fmt(n, dash = false) {
  n = num(n);
  if (dash && n === 0) return '—';
  const neg = n < 0;
  let a = Math.abs(n);
  let out;
  if (a >= 1e12) out = `$${(a / 1e12).toFixed(2)}T`;
  else if (a >= 1e9) out = `$${(a / 1e9).toFixed(2)}B`;
  else if (a >= 1e6) out = `$${(a / 1e6).toFixed(2)}M`;
  else if (a >= 1e4) out = `$${(a / 1e3).toFixed(1)}K`;
  else if (a >= 1) out = `$${a.toFixed(2)}`;
  else if (a > 0) out = `$${a.toFixed(6)}`;
  else out = '$0';
  return (neg ? '-$' : '').slice(0, neg ? 1 : 0) + (neg ? '$-' + out.slice(1) : out);
}

/** Coin-quantity formatter (avoid huge decimals) */
export function cfmt(n) {
  n = num(n);
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${neg}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${neg}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${neg}${(a / 1e3).toFixed(2)}K`;
  if (a >= 1) return `${neg}${a.toFixed(2)}`;
  return `${neg}${a.toFixed(4)}`;
}

// ---------- DOM helpers ----------
export const el = (id) => document.getElementById(id);
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// Tiny toast system
export function toast(text, kind = 'info') {
  const box = el('toasts');
  if (!box) return;
  const t = h(`<div class="toast ${kind}">${esc(text)}</div>`);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 4600);
}

// ---------- misc ----------
export const uid = () => Math.floor(rng() * 1e10).toString(36) + Date.now().toString(36);
export const clampPrice = (v) => clamp(v, 1e-9, 1e15);
export function pushCapped(arr, item, cap = 140) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}
export function sum(list, fn = (x) => x) {
  return list.reduce((a, x) => a + num(fn(x)), 0);
}
