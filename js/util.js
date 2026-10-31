/* OMNILIFE core utilities + UI services: single-toast queue,
 * notification-centre store, position/flow cache (UI-layer, not saved in game state). */

// Deterministic-enough RNG (mulberry32) — the world engine stays seeded
// per save so reloads don't re-roll history.
let RNG_STATE = Date.now() >>> 0;

export function seedRng(n) {
  RNG_STATE = n >>> 0 || 123456789;
}
export function rng() {
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
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/** Diff-write innerHTML into a node; keeps focus when it lived inside. */
export function put(node, html) {
  if (!node) return;
  const act = node.contains(document.activeElement) ? document.activeElement : null;
  if (act && act.id && act.value !== undefined) {
    // preserve typed value across rebuild
    const id2 = act.id, v2 = act.value;
    if (node.__v === html) return;
    node.innerHTML = html;
    const n2 = document.getElementById(id2);
    if (n2) { n2.value = v2; n2.focus(); }
  } else {
    if (node.__v === html) return;
    node.innerHTML = html;
  }
  node.__v = html;
}

/** Diff-write text into a node (per-tick hot path) */
export function setT(node, val) {
  if (!node) return;
  if (node.__t === val) return;
  node.__t = val;
  node.textContent = val;
}

// ---------- NOTIFICATION CENTRE ----------
const NK = 'omnilife.noti.v1';
let NOTIS = [];
let UNREAD = 0;
try {
  NOTIS = JSON.parse(localStorage.getItem(NK) || '[]');
  if (!Array.isArray(NOTIS)) NOTIS = [];
} catch { NOTIS = []; }
const notiSave = () => { try { localStorage.setItem(NK, JSON.stringify(NOTIS.slice(0, 40))); } catch {} };

export function pushNoti(text, kind = 'info') {
  NOTIS.push({ t: Date.now(), text, kind });
  UNREAD += 1;
  notiSave();
  window.dispatchEvent(new CustomEvent('omni-noti'));
}
export function getNotis() { return NOTIS; }
export function unreadCount() { return UNREAD; }
export function clearUnread() { UNREAD = 0; window.dispatchEvent(new CustomEvent('omni-noti')); }
export function clearNotis() {
  NOTIS = [];
  UNREAD = 0;
  notiSave();
  window.dispatchEvent(new CustomEvent('omni-noti'));
}

// ---------- SINGLE (non-stacking) TOAST ----------
let toastTimer = 0;
export function toast(text, kind = 'info') {
  const box = el('toast');
  if (box) {
    box.classList.remove('show', 'ok', 'bad', 'warn');
    void box.offsetWidth; // restart transition
    box.textContent = text;
    if (kind === 'ok' || kind === 'bad' || kind === 'warn') box.classList.add(kind);
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 4200);
  } else { console.log('[toast]', kind, text); }
  pushNoti(text, kind);
}

// ---------- UI-layer caches (kept OUT of the game state) ----------
const PK = 'omnilife.pos.v1';
export const UC = { pos: {}, flow: { day: -1, i: 0, e: 0 } };
try { const p = JSON.parse(localStorage.getItem(PK) || '{}'); if (p && typeof p === 'object') UC.pos = p; } catch {}
export function savePos() { try { localStorage.setItem(PK, JSON.stringify(UC.pos)); } catch {} }
/** Record income/expense flow for "today" (resets when the in-world day rolls) */
export function addFlow(s, delta) {
  const day = Math.floor(s.tick / 48);
  if (UC.flow.day !== day) { UC.flow.day = day; UC.flow.i = 0; UC.flow.e = 0; }
  if (delta >= 0) UC.flow.i += delta; else UC.flow.e -= delta;
}
export function resetFlow(s) { UC.flow = { day: Math.floor(s.tick / 48), i: 0, e: 0 }; }
export function getFlow() { return UC.flow; }

// ---------- misc ----------
export const uid = () => Math.floor(rng() * 1e10).toString(36) + Date.now().toString(36);
export function pushCapped(arr, item, cap = 140) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}
export function sum(list, fn = (x) => x) {
  return list.reduce((a, x) => a + num(fn(x)), 0);
}
