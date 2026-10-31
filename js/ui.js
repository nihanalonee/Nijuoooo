/* OMNILIFE UI v2 — dashboard hierarchy, 5-tab mobile nav + More sheet,
 * wizard create flows, one-thumb trade panel with order preview,
 * P/L position lists, notification centre, per-tick incremental updates.
 * Engine (state.js / market.js / city.js / …) is untouched. */

import { fmt, cfmt, num, clamp, esc, pct, el, put, setT, getFlow, UC, getNotis, unreadCount, clearUnread, toast } from './util.js';
import { P, price, netWorth, GOD_EMAIL } from './state.js';
import * as mk from './market.js';
import * as ct from './city.js';
import * as md from './media.js';
import * as ac from './actions.js';
import { runGod, HELP as GOD_HELP } from './god.js';

// ---------------- navigation model ----------------
export const PANELS = [
  { id: 'dash',  ic: '📊', name: 'Command',   m: 1, tag: 'overview dashboard net worth' },
  { id: 'trade', ic: '💠', name: 'Markets',   m: 1, tag: 'dex crypto stocks trade buy sell' },
  { id: 'city',  ic: '🏙️', name: 'City ISP',  m: 1, tag: 'fiber racks mining districts property' },
  { id: 'bank',  ic: '🏦', name: 'Banking',   m: 1, tag: 'deposit loan reserve rates bankrun' },
  { id: 'more',  ic: '☰', name: 'More',      m: 'more' },
  { id: 'lab',   ic: '🧪', name: 'Crypto Lab', tag: 'mint token liquidity stake rug flash lp' },
  { id: 'media', ic: '📺', name: 'Media TV',  tag: 'network shows propaganda fake news reach' },
  { id: 'crime', ic: '💀', name: 'Underworld', tag: 'launder hack merc smuggle bribe dirty' },
  { id: 'gov',   ic: '🏛️', name: 'Government', tag: 'law senate lobby tax warrant bailout' },
  { id: 'wire',  ic: '📡', name: 'The Wire',  tag: 'feed social posts scandal tape' },
];

// ---------------- tiny state / caches ----------------
let S = null;
export function setS(s) { S = s; }

const TIPS = {
  gas: 'GAS: a per-trade network fee. It rises when the ISP backbone is congested.',
  slippage: 'SLIPPAGE: moving a big order through a thin pool worsens your average price.',
  tax: 'CAPITAL-GAINS TAX: taken on profits only (sale price above your baseline), not on full proceeds.',
  amm: 'AMM: an Automated Market Maker prices assets from a liquidity pool (x*y=k) instead of order books.',
  lp: 'LIQUIDITY: depositing cash into a pool earns exit fees but exposes you to price moves.',
  runrisk: 'RUN RISK: chance depositors panic-withdraw this tick. Falls as your reserve ratio grows.',
  reserveratio: 'RESERVE RATIO: reserves ÷ deposits. Below ~25% you are dangerously fractional.',
  rug: 'RUG PULL: draining your own pool into dirty cash. Instant +38 heat and a dead token.',
  Wettbewerb: '',
  heat: 'HEAT: police attention, 0–100. High heat = sting risk, warrant seizures and lowered uptime.',
  reach: 'REACH: share of the population watching your network. Drives ad revenue and narrative power.',
  fcc: 'FCC HEAT: regulator attention on your network. Fake news raises it; 3+ triggers fines.',
  peg: 'PEG: a stablecoin aims to hold $1.00. It mean-reverts via arbitrage flows.',
  pl: 'P/L: unrealized profit & loss = current value − average entry cost.',
  support: 'SUPPORT: share of senators currently backing the docket. Above 50% it passes.',
};
const ta = (k) => `<span class="tip" data-tip="${esc(TIPS[k] || k)}">ⓘ</span>`;
const emptyB = (text) => `<div class="empty">${text}</div>`;

const wirePost = (w) => `<div class="post ${w.kind}"><span class="t">d${Math.floor(w.t / 48) + 1}</span><b>${w.kind === 'market' ? 'TAPE' : w.kind === 'scandal' ? 'ACTION' : 'LORE'}</b> ${esc(w.text)}</div>`;

// ---------------- charts ----------------
function drawAll() {
  document.querySelectorAll('canvas[data-hist]').forEach((cv) => {
    if (cv.__v === cv.dataset.hist) return;
    cv.__v = cv.dataset.hist;
    const data = (cv.dataset.hist || '').split(',').filter((x) => x !== '').map(Number);
    if (data.length < 2) return;
    const w = cv.clientWidth || 300, hgt = cv.clientHeight || 44;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = hgt * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const min = Math.min(...data), max = Math.max(...data);
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.05 || 1;
    const lo = min - pad, hi = max + pad;
    const X = (i) => (i / (data.length - 1)) * (w - 2) + 1;
    const Y = (v) => hgt - 3 - ((v - lo) / (hi - lo)) * (hgt - 6);
    const color = cv.dataset.color || '#0a5da4';
    if (cv.dataset.fill) {
      const g = c.createLinearGradient(0, 0, 0, hgt);
      g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(X(0), hgt);
      data.forEach((v, i) => c.lineTo(X(i), Y(v)));
      c.lineTo(X(data.length - 1), hgt); c.closePath(); c.fill();
    }
    c.strokeStyle = color; c.lineWidth = 1.6; c.beginPath();
    data.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.stroke();
  });
}
const cvt = (hist, cls, color, fill) => {
  const data = hist.slice(-120).map((v) => (Number.isFinite(v) ? +v.toPrecision(5) : 0));
  return `<canvas class="${cls}" data-hist="${data.join(',')}" data-color="${color}" ${fill ? 'data-fill="1"' : ''}></canvas>`;
};

const chg = (hist, n = 8) => {
  const h = hist.slice(-n);
  if (h.length < 2) return 0;
  const a = h[0], b = h[h.length - 1];
  return (b - a) / Math.max(1e-12, a);
};
const chgFmt = (v) => `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v * 100).toFixed(1)}%</span>`;

// ---------------- topbar ----------------
export function renderTop(s) {
  S = s;
  const day = Math.floor(s.tick / 48) + 1;
  const hour = Math.floor(((s.tick % 48) / 2) + 6) % 24;
  const un = unreadCount();
  const html = `
    <div class="tb-row">
      <div class="stat"><b class="mono"><span class="dot"></span>OMNILIFE</b><span>${esc(s.name)}</span></div>
      <div class="stat"><b class="mono">${day}d ${String(hour).padStart(2, '0')}:00</b><span>Sector-7</span></div>
      <div class="stat"><b class="mono" id="t_nw">${fmt(netWorth(s))}</b><span>Net worth</span></div>
      <div class="stat"><b class="mono up" id="t_cash">${fmt(P(s).cash)}</b><span>Clean</span></div>
      <div class="stat"><b class="mono down" id="t_dirty">${fmt(P(s).dirty)}</b><span>Dirty</span></div>
      <div class="stat"><b class="mono" id="t_heat">${pct(P(s).heat / 100, 0)}</b><span>Heat</span>
        <div class="heatbar"><i style="width:${P(s).heat}%"></i></div></div>
      <div class="spacer"></div>
      <div id="speedBox">
        ${[0, 1, 2, 4].map((x) => `<button class="spd ${s.speed === x ? 'on' : ''}" data-act="speed:${x}" aria-label="speed ${x}">${x === 0 ? '❚❚' : x + '×'}</button>`).join('')}
        <button class="spd" data-act="newgame">⟲ New</button>
        <button class="spd bell" data-act="noti" aria-label="notifications">🔔${un ? `<span class="nbdg">${un}</span>` : ''}</button>
      </div>
    </div>
    <div class="statusline">
      <span>GAS $${s.market.gasFee}</span><span>NET ${(s.city.congestion * 100).toFixed(0)}%</span>
      <span>SENT-C ${(s.market.sentiment.crypto * 100).toFixed(0)}%</span>
      <span>SENT-M ${(s.market.sentiment.media * 100).toFixed(0)}%</span>
      ${s.gov.warrants ? `<span style="color:var(--red)">WARRANTS ${s.gov.warrants}</span>` : ''}
      ${s.god ? '<span style="color:var(--acc)">GOD✔</span>' : ''}
      <span style="margin-left:auto">(AUTOSAVE ACTIVE)</span>
    </div>`;
  put(el('topbar'), html);
}

// ---------------- side nav + search ----------------
let NAV_SIG = '';
export function renderNav(s) {
  S = s;
  // only rebuild when something visible actually changed (badges, active
  // panel, god unlock). Keeps user's search filtering intact between ticks.
  const sig = `${s.ui.panel}|${s.gov.warrants}|${P(s).dirty > 1000 ? 1 : 0}|${s.god ? 1 : 0}|${unreadCount() > 0 ? 1 : 0}`;
  if (sig === NAV_SIG) return;
  NAV_SIG = sig;
  // GOD page appended only when unlocked
  const pages = s.god ? [...PANELS, { id: 'god', ic: '🔥', name: 'God Mode', tag: 'admin cheat terminal' }] : PANELS;
  const list = pages.filter((p) => p.id !== 'more').map((p) => {
    let badge = '';
    if (p.id === 'gov' && s.gov.warrants > 0) badge = `<span class="badge">⚖${s.gov.warrants}</span>`;
    if (p.id === 'crime' && P(s).dirty > 1000) badge = `<span class="badge">$</span>`;
    const dm = p.m ? ` data-m="${p.m}"` : '';
    return `<button class="nav ${s.ui.panel === p.id ? 'on' : ''}" data-act="go:${p.id}"${dm} data-name="${esc(p.name)}">
      <span class="ic">${p.ic}</span><span>${esc(p.name)}</span>${badge}</button>`;
  }).join('');
  const html = `
    <input id="pgsearch" class="navsearch" placeholder="🔎 Find page…" data-r="navsearch" inputmode="search" />
    ${list}
    <button class="nav moretab" data-act="more" data-m="more"><span class="ic">☰</span><span>More</span></button>`;
  put(el('side'), html);
}

function filterNav(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#side .nav').forEach((n) => {
    const hit = !q || (n.dataset.name || '').toLowerCase().includes(q) || (PANELS.find((p) => p.id === n.dataset.act?.slice(3))?.tag || '').includes(q);
    const active = S && S.ui.panel === n.dataset.act?.slice(3);
    n.style.display = (hit || active) ? '' : 'none';
  });
}

// ---------------- shared components ----------------
const tile = (lbl, id) => `<div class="tile"><b id="${id}">—</b><span>${lbl}</span></div>`;

// ---------------- THE WIRE list ----------------
function feedHtml(s, filter) {
  const posts = s.wire.filter((w) => filter === 'all' || w.kind === filter);
  return posts.slice(-80).reverse().map(wirePost).join('') || emptyB('Silence on the wire… suspicious.');
}

// ================= PAGE: DASH (true dashboard) =================
function recAdvice(s) {
  const p = P(s);
  if (s.gov.warrants > 0) return { ic: '⚖️', txt: `${s.gov.warrants} warrant${s.gov.warrants > 1 ? 's' : ''} active — settle before the seizure sweep.`, act: 'bribe', go: 'crime', lbl: 'Deal with it 💀' };
  if (p.heat > 65) return { ic: '🚨', txt: 'Heat is boiling. Pay off consultants to cool down before stings.', act: 'bribe', go: 'crime', lbl: 'Bribe officials 💰' };
  if (p.dirty > 0) return { ic: '🧼', txt: `You hold ${fmt(p.dirty)} in dirty cash — it can be seized or taxed. Launder it.`, act: 'launder', go: 'crime', lbl: 'Launder now' };
  if (p.bank && !p.bank.failed && p.bank.runRisk > 0.5) return { ic: '🏦', txt: `Bank run risk ${pct(p.bank.runRisk, 0)}. Recapitalize reserves before the panic.`, act: 'recap', go: 'bank', lbl: 'Open Banking 🏦' };
  if (p.outageTicks > 0) return { ic: '🔌', txt: `ISP outage: ${p.outageTicks} ticks left. Mining idle.`, act: 'go:city', go: 'city', lbl: 'Check City 🏙️' };
  if (s.gov.pending && s.gov.pending.support > 0.55) return { ic: '🗳️', txt: `Senate is passing "${s.gov.pending.name}". Lobby against it.`, act: 'lobby', go: 'gov', lbl: 'Lobby 🏛️' };
  if (s.city.congestion > 1.2) return { ic: '🌐', txt: 'Backbone congestion is raising gas for everyone. Lay fiber.', act: 'fiber', go: 'city', lbl: 'City & ISP 🌐' };
  if (!p.bank && p.cash >= ct.BANK_FOUND_COST) return { ic: '🏦', txt: 'You can afford a bank charter — deposits compound while you trade.', act: 'wizOpen:bank', go: null, lbl: 'Start wizard 🏦' };
  if (!p.miningOn && p.racks > 0) return { ic: '⛏️', txt: 'Your racks are idle. Resume mining for passive tokens.', act: 'mine', go: null, lbl: 'Resume ⛏️' };
  if (p.cash >= mk.FOUND_COST && !s.corps.find((c) => c.playerOwned)) return { ic: '💼', txt: 'You can take your empire public — IPO for reputation & stock,', act: 'wizOpen:ipo', go: null, lbl: 'IPO wizard 💼' };
  if (!p.media && p.cash >= md.NETWORK_COST) return { ic: '📺', txt: 'Affordable TV license. Reach = narrative power.', act: 'wizOpen:tv', go: null, lbl: 'TV wizard 📺' };
  if (p.racks < 5 && p.cash > ct.RACK_COST) return { ic: '⚡', txt: 'More racks = more hash rate and a stronger defense vs hacks.', act: 'rack', go: null, lbl: 'Buy rack ⚡' };
  return { ic: '📈', txt: 'Scan the token board for dips and grow the stack.', act: 'go:trade', go: null, lbl: 'Open DEX 💠' };
}

function alertList(s) {
  const A = [];
  const p = P(s);
  if (s.gov.warrants) A.push(['⚖️', `${s.gov.warrants} active warrant(s) — assets at risk.`, 'gov']);
  if (p.bank && !p.bank.failed && p.bank.reserve / Math.max(1, p.bank.deposits) < 0.25) A.push(['🏦', 'Reserve ratio below 25% — bank run territory.', 'bank']);
  if (p.outageTicks > 0) A.push(['🔌', `Datacenter offline — back in ${p.outageTicks} ticks.`, 'city']);
  if (s.city.congestion > 1.3) A.push(['🌐', 'Backbone congested: gas fees & slippage elevated.', 'city']);
  if (s.gov.pending) A.push(['🗳️', `Docket: "${s.gov.pending.name}" — support ${pct(s.gov.pending.support, 0)}.`, 'gov']);
  if (p.dirty > 1e5) A.push(['🧼', `${fmt(p.dirty)} dirty cash waiting to be cleaned.`, 'crime']);
  else if (p.heat > 70) A.push(['🚨', 'Heat critical: stings & seizures imminent.', 'crime']);
  return A;
}

function posRows(s) {
  const p = P(s);
  let html = '';
  for (const t of s.tokens) {
    const q = p.tok[t.sym] || 0;
    if (q <= 1e-9) continue;
    const v = q * price(t);
    const b = UC.pos[t.sym];
    const cost = b ? b.c * (b.q > 0 ? Math.min(1, q / b.q) : 0) : 0;
    const pl = v - cost;
    html += `<div class="row-item"><span class="sym">${t.sym}</span><span class="mono">${cfmt(q)}</span>
      <span class="mono">${fmt(v)}</span>
      <span class="mono ${pl >= 0 ? 'up' : 'down'}">${b ? (pl >= 0 ? '+' : '') + fmt(pl) : '—'}</span></div>`;
  }
  for (const c of s.corps) {
    const q = p.shares[c.id] || 0;
    if (q <= 0 || !c.alive) continue;
    const v = q * c.price;
    const b = UC.pos['S:' + c.id];
    const cost = b ? b.c * (b.q > 0 ? Math.min(1, q / b.q) : 0) : 0;
    const pl = v - cost;
    html += `<div class="row-item"><span class="sym">${esc(c.name)}</span><span class="mono">${cfmt(q)} sh</span>
      <span class="mono">${fmt(v)}</span><span class="mono ${pl >= 0 ? 'up' : 'down'}">${b ? (pl >= 0 ? '+' : '') + fmt(pl) : '—'}</span></div>`;
  }
  return html || emptyB('No positions yet. Buy something in Markets 💠');
}

export function dashHtml(s) {
  const flow = getFlow();
  return `
  <div class="tiles">
    ${tile('NET WORTH', 'u_nw')}${tile('CLEAN CASH', 'u_cash')}${tile('TODAY NET FLOW', 'u_flow')}
  </div>
  <div class="primary">
    <button class="btn" data-act="go:trade">💱 Trade</button>
    <button class="btn" data-act="wizOpen:token">🧪 Mint coin</button>
    <button class="btn" data-act="wizOpen:bank">🏦 Charter bank</button>
    <button class="btn" data-act="wizOpen:ipo">💼 IPO</button>
    <button class="btn" data-act="wizOpen:tv">📺 Launch TV</button>
    <button class="btn" data-act="go:crime">💀 Ops</button>
    ${S && S.god ? '<button class="btn gold" data-act="go:god">🔥 God Mode</button>' : ''}
  </div>
  <div class="card rec"><h3>NEXT RECOMMENDED ACTION</h3><div id="u_rec"></div></div>
  <div class="card"><h3>ALERTS <span class="rt" id="u_aln"></span></h3><div id="u_alerts"></div></div>
  <details class="sec" open><summary>📁 POSITIONS <span class="tip" data-tip="${esc(TIPS.pl)}">ⓘ</span></summary><div id="u_port"></div></details>
  <details class="sec"><summary>🧾 EMPIRE LOG</summary><div class="log" id="u_log"></div></details>
  <details class="sec"><summary>📡 THE WIRE — LIVE</summary><div class="feed" id="u_wire5"></div></details>`;
}
export function dashUpd(s) {
  setT(el('u_nw'), fmt(netWorth(s)));
  setT(el('u_cash'), fmt(P(s).cash));
  const f = getFlow();
  const net = f.i - f.e;
  const fn = el('u_flow');
  if (fn) {
    setT(fn, (net >= 0 ? '+' : '') + fmt(net));
    fn.className = net >= 0 ? 'up' : 'down';
  }
  const rec = recAdvice(s);
  put(el('u_rec'), `<div class="row"><span class="rec-ic">${rec.ic}</span><span style="flex:1">${esc(rec.txt)}</span></div>
    <button class="btn" data-act="${rec.act}" style="margin-top:8px">${esc(rec.lbl)}</button>`);
  const A = alertList(s);
  setT(el('u_aln'), A.length ? `${A.length} active` : 'none');
  put(el('u_alerts'), A.length
    ? A.map(([ic, txt, go]) => `<button class="row-item alert" data-act="go:${go}"><span>${ic}</span><span style="flex:1">${esc(txt)}</span><b class="mono">›</b></button>`).join('')
    : emptyB('No alerts. The streets are quiet.'));
  put(el('u_port'), posRows(s));
  const lg = el('u_log');
  if (lg) {
    const h = s.log.slice(-16).reverse().map((l) => `<div><span class="t">${l.t}</span>${esc(l.text)}</div>`).join('');
    put(lg, h || '<div class="dim">World silence…</div>');
  }
  put(el('u_wire5'), s.wire.slice(-5).reverse().map(wirePost).join(''));
  drawAll();
}

// ================= PAGE: TRADE (one-thumb + preview) =================
function tokenChips(s) {
  return `<div class="chiprow">${s.tokens.map((t) =>
    `<button class="chip ${s.uiSel.sym === t.sym ? 'on' : ''}" data-act="sel:${t.sym}">${t.sym}${t.rugPulled ? '💀' : ''}</button>`).join('')}</div>`;
}

function tradeTokHtml(s, t) {
  const held = P(s).tok[t.sym] || 0;
  return `
  ${tokenChips(s)}
  <div class="card sel">
    <h3>${t.sym} <span class="rt">${esc(t.name)}</span></h3>
    <div class="row"><div class="bigflow mono" id="u_price">${fmt(price(t))}</div><div id="u_chg" style="min-width:74px"></div>
      ${t.rugPulled ? '<span class="pill r blink">RUGGED 💀</span>' : ''}
      <span class="pill">bag <b class="mono">${cfmt(held)}</b></span></div>
    <div id="u_chart" style="margin:8px 0">${cvt(t.hist, 'chartBig', '#0a5da4', 1)}</div>
    <div class="panel">
      <div class="row"><input id="opBuy" type="number" min="0" step="any" inputmode="decimal" placeholder="USD to spend" style="flex:1" />
        <button class="chip" data-act="chip:opBuy:0.25">¼</button>
        <button class="chip" data-act="chip:opBuy:0.5">½</button>
        <button class="chip" data-act="chip:opBuy:1">MAX</button></div>
      <div class="row"><button class="btn buy" data-act="buy:${t.sym}">BUY ${t.sym}</button></div>
      <div class="row"><input id="opSell" type="number" min="0" step="any" inputmode="decimal" placeholder="${t.sym} qty to sell" style="flex:1" />
        <button class="chip" data-act="chipu:opSell:${t.sym}:0.25">¼ bag</button>
        <button class="chip" data-act="chipu:opSell:${t.sym}:1">ALL</button></div>
      <div class="row"><button class="btn danger" data-act="sell:${t.sym}">SELL ${t.sym}</button></div>
    </div>
    <div class="preview" id="u_prev">${emptyB('Enter an amount to preview the order — fee, tax & resulting balance. 👆')}</div>
  </div>
  <div class="card"><h3>YOUR POSITIONS ${ta('pl')}</h3><div id="u_pos"></div></div>
  <details class="sec"><summary>_FULL TOKEN BOARD</summary>
    <div class="sc cardify"><table>
      <tr><th>Sym</th><th>Price</th><th>Trend</th><th>Pool</th><th>Your bag</th><th></th></tr>
      ${s.tokens.map((x) => `<tr>
        <td data-l="Sym"><span class="sym">${x.sym}</span><div class="dim" style="font-size:10px">${esc(x.name)}${x.creator === s.name ? ' · MINE' : ''}</div></td>
        <td data-l="Price" class="mono">${fmt(price(x))}</td>
        <td data-l="Trend">${chgFmt(chg(x.hist, 12))}</td>
        <td data-l="Pool" class="mono">${fmt(x.pool.cash)}</td>
        <td data-l="Bag" class="mono">${cfmt(P(s).tok[x.sym] || 0)}</td>
        <td data-l=""><button class="chip" data-act="sel:${x.sym}">OPEN</button></td></tr>`).join('')}
    </table></div>
    <p class="opnote">Gas ${'$' + s.market.gasFee} ${ta('gas')} · congestion ${(s.market.congestion * 100).toFixed(0)}% ${ta('slippage')} · tax ${(s.gov.tax * 100).toFixed(0)}% ${ta('tax')}</p>
  </details>`;
}

function tradeStkHtml(s) {
  return `
  <div class="card"><h3>EQUITY EXCHANGE</h3>
    ${s.corps.filter((c) => c.alive).map((c) => {
      const held = P(s).shares[c.id] || 0;
      const b = UC.pos['S:' + c.id];
      const pl = held * c.price - (b ? b.c * Math.min(1, held / Math.max(1e-9, b.q)) : 0);
      return `<div class="row-item">
        <div style="flex:1;min-width:0"><span class="sym">${esc(c.name)}</span> <span class="pill">${esc(c.sector)}</span>
          <div class="dim" style="font-size:10.5px">CEO ${esc(c.ceo)} · ${'$' + c.price.toFixed(2)} · cap ${fmt(c.price * c.shares)}
          ${held ? ` · hold ${cfmt(held)} sh ${pl >= 0 ? '<b class="up">+' : '<b class="down">'}${fmt(pl)}</b>` : ''}</div>
          <div class="row"><input id="sh_${c.id}" type="number" min="0" placeholder="qty" style="width:98px" />
            <button class="chip" data-act="shbuy:${c.id}">BUY</button>
            <button class="chip" data-act="shsell:${c.id}">SELL ALL</button></div>
        </div></div>`;
    }).join('') || emptyB('No listed companies.')}
  </div>
  <div class="row"><input id="corpName" placeholder="new company name" style="flex:1" />
    <button class="btn gold" data-act="wizOpen:ipo">💼 IPO wizard</button></div>
  <p class="opnote">Going public: ${fmt(mk.FOUND_COST)} — you list at $10 and own 100% (120M shares), +6 reputation.</p>`;
}

function tradePrev(s) {
  const box = el('u_prev');
  if (!box) return;
  const t = s.tokens.find((x) => x.sym === s.uiSel.sym) || s.tokens[0];
  const buy = num((el('opBuy') || {}).value);
  const sell = num((el('opSell') || {}).value);
  const rows = [];
  if (buy > 0) {
    const q = mk.quote(t.pool, buy, true);
    const tokOut = q.out / mk.execSlippage(s);
    const gas = s.market.gasFee;
    if (buy + gas <= P(s).cash) rows.push(`<div class="pvrow"><b>BUY</b><span>${cfmt(tokOut)} ${t.sym}</span></div>
      <div class="pvrow dim"><span>avg ${fmt(q.avgPrice / mk.execSlippage(s))} · gas ${fmt(gas)} ${ta('gas')} · sweep ${(mk.execSlippage(s) * 100 - 100).toFixed(1)}% ${ta('slippage')}</span></div>
      <div class="pvrow"><span>resulting</span><span class="mono">${fmt(P(s).cash - buy - gas)} · bag ${cfmt((P(s).tok[t.sym] || 0) + tokOut)} ${t.sym}</span></div>`);
    else rows.push(`<div class="pvrow"><span class="down">Insufficient cash: need ${fmt(buy + gas)}</span></div>`);
  }
  if (sell > 0) {
    const held = P(s).tok[t.sym] || 0;
    if (sell > held) rows.push(`<div class="pvrow"><span class="down">You only hold ${cfmt(held)} ${t.sym}</span></div>`);
    else {
      const gross = mk.quote(t.pool, sell, false).out;
      const basis = UC.pos[t.sym]?.c / Math.max(1e-9, UC.pos[t.sym]?.q || 1) || t.p0;
      const taxDue = price(t) > basis ? gross * s.gov.tax * 0.5 : 0;
      const net = Math.max(0, gross - taxDue - s.market.gasFee);
      rows.push(`<div class="pvrow"><b>SELL</b><span>${fmt(net)}</span></div>
        <div class="pvrow dim"><span>gross ${fmt(gross)} · tax ${fmt(taxDue)} ${ta('tax')} · gas ${fmt(s.market.gasFee)}</span></div>
        <div class="pvrow"><span>resulting</span><span class="mono">${fmt(P(s).cash + net)} · bag ${cfmt(held - sell)} ${t.sym}</span></div>`);
    }
  }
  put(box, rows.join('') || emptyB('Enter an amount to preview the order — fee, tax & resulting balance. 👆'));
}

export function tradeHtml(s) {
  s.ui.sub = s.ui.sub || 'tok';
  const t = s.tokens.find((x) => x.sym === s.uiSel.sym) || s.tokens[0];
  return `
  <div class="tabs">
    <button class="tab ${s.ui.sub === 'tok' ? 'on' : ''}" data-act="sub:tok">💠 COINS</button>
    <button class="tab ${s.ui.sub === 'stk' ? 'on' : ''}" data-act="sub:stk">💼 EQUITIES</button>
  </div>
  <div id="tradeBody">${s.ui.sub === 'tok' ? tradeTokHtml(s, t) : tradeStkHtml(s)}</div>`;
}

export function tradeUpd(s) {
  const t = s.tokens.find((x) => x.sym === s.uiSel.sym) || s.tokens[0];
  setT(el('u_price'), fmt(price(t)));
  put(el('u_chart'), cvt(t.hist, 'chartBig', '#0a5da4', 1));
  const ch = el('u_chg');
  if (ch) {
    const c = chg(t.hist, 12);
    put(ch, `<span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(1)}%</span>`);
  }
  const pos = el('u_pos');
  if (pos) {
    const rows = s.tokens.filter((x) => (P(s).tok[x.sym] || 0) > 1e-9).map((x) => {
      const q = P(s).tok[x.sym];
      const v = q * price(x);
      const b = UC.pos[x.sym];
      const cost = b ? b.c * Math.min(1, q / Math.max(1e-9, b.q)) : 0;
      const pl = v - cost;
      return `<a class="row-item" href="#" data-act="sel:${x.sym}" data-nav><span class="sym mono">${x.sym}</span><span class="mono">${cfmt(q)}</span><span class="mono">${fmt(v)}</span><span class="mono ${pl >= 0 ? 'up' : 'down'}">${b ? (pl >= 0 ? '+' : '') + fmt(pl) : '—'}</span></a>`;
    }).join('');
    put(pos, rows || emptyB('No coin positions yet.'));
  }
  tradePrev(s);
  drawAll();
}

// ================= PAGE: CITY & ISP =================
export function cityHtml(s) {
  return `
  <div class="tiles">${tile('UPTIME', 'c_ut')}${tile('HASH RATE', 'c_hr')}${tile('CONGESTION', 'u_cong')}</div>
  <div class="primary">
    <button class="btn" data-act="rack" id="c_rack">＋ Rack</button>
    <button class="btn" data-act="mine" id="c_mine">⛏ Mining</button>
    <button class="btn" data-act="fiber:slum" id="c_fiber">＋ Fiber</button>
  </div>
  ${P(s).outageTicks > 0 ? `<div class="card alertr"><h3>PARTIAL OUTAGE</h3><p class="warn blink">DDoS flood in progress — mining halted, ${P(s).outageTicks} ticks remaining.</p></div>` : ''}
  <details class="sec" open><summary>🏙️ DISTRICTS — REAL ESTATE & FIBER</summary>
    <div id="u_dist"></div>
  </details>
  <details class="sec"><summary>📁 REAL-ESTATE PORTFOLIO</summary><div id="u_props"></div></details>
  <details class="sec"><summary>⚡ BACKBONE NOTES</summary>
    <p class="opnote">${ta('gas')} Gas fees track congestion citywide. Fiber lines raise capacity and property values; racks convert uptime into mined tokens. Outages (from rival hacks) stop mining until repaired.</p>
  </details>`;
}
export function cityUpd(s) {
  setT(el('c_ut'), pct(ct.ispUptime(s), 0));
  setT(el('c_hr'), cfmt(ct.hashRate(s)) + ' MH/s');
  const cg = el('u_cong');
  if (cg) {
    const v = s.city.congestion;
    setT(cg, pct(v, 0) + (v > 1.3 ? ' ⚠️' : ''));
    cg.className = v > 1.3 ? 'down' : v > 0.8 ? 'warn' : 'up';
  }
  put(el('c_rack'), `＋ Rack — ${fmt(ct.RACK_COST * (P(s).racks + 1) ** 1.15)}`);
  put(el('c_mine'), P(s).miningOn ? '⏸ Pause mining' : '⛏ Resume mining');
  const dCheap = s.city.districts.slice().sort((a, b) => ct.fiberCost(a) - ct.fiberCost(b))[0];
  put(el('c_fiber'), `＋ Fiber — ${fmt(ct.fiberCost(dCheap))}`);
  const dist = el('u_dist');
  if (dist) {
    put(dist, `<div class="sc cardify"><table>
      <tr><th>District</th><th>Index</th><th>Crime</th><th>Fiber</th><th>Ops</th></tr>
      ${s.city.districts.map((d) => `<tr>
        <td data-l="District">${d.emoji} ${esc(d.name)}<div class="dim" style="font-size:10px">${d.crime > 0.4 ? '<span class="warn">high crime</span>' : 'policed'} ${P(s).props[d.id] ? ` · units:${P(s).props[d.id]}` : ''}</div></td>
        <td data-l="Index" class="mono">${(d.idx * 100).toFixed(0)}</td>
        <td data-l="Crime" class="mono dim">${pct(d.crime, 0)}</td>
        <td data-l="Fiber" class="mono">${d.fiber || 0}</td>
        <td data-l="Ops"><div class="row">
          <button class="chip" data-act="prop:${d.id}">Buy ${fmt(ct.propPrice(d))}</button>
          <button class="chip" data-act="fiber:${d.id}">Lay ${fmt(ct.fiberCost(d))}</button></div></td>
      </tr>`).join('')}
    </table></div>
    <p class="opnote">Congestion ${(s.city.congestion * 100).toFixed(0)}% ${ta('slippage')} · sentiment ${chgFmt(s.city.districts[0].sentiment - 0.5)}</p>`);
  }
  const props = el('u_props');
  if (props) {
    const total = s.city.districts.reduce((a, d) => a + (P(s).props[d.id] || 0), 0);
    put(props, total
      ? `<div class="row-item"><span>Units owned</span><b class="mono">${total}</b></div>
         <div class="row-item"><span>Estimated rent / day</span><b class="mono up">${fmt(ct.rentIncome(s))}</b></div>`
      : emptyB('No property yet — buy in a low-crime district and fiber it first.'));
  }
  drawAll();
}

// ================= PAGE: BANKING =================
export function bankHtml(s) {
  const b = P(s).bank;
  if (!b) return `
  <div class="tiles">${tile('DEPOSITS', 'b_d0')}${tile('YOUR BANK', 'b_x')}${tile('CHARTER COST', 'b_c')}</div>
  <div class="card sel"><h3>CHARTER A BANK ${ta('reserveratio')}</h3>
    <p class="dim" style="font-size:12px">You inherit a depositor base. Set rates to attract their friends, underwrite loans at your chosen risk level. Thin reserves → panic-run → collapse. ${ta('runrisk')}</p>
    <button class="btn gold" data-act="wizOpen:bank" style="margin-top:10px">🏦 Bank wizard</button></div>`;
  if (b.failed) return `
  <div class="tiles">${tile('DEPOSITS', 'b_d0')}${tile('BANK', 'b_x')}${tile('EQUITY', 'b_e')}</div>
  <div class="card alertr"><h3>BANKRUPT</h3><p class="dim">Your bank collapsed. The government opened a bailout docket to bury the crater.</p>
  <button class="btn gold" data-act="wizOpen:bank" style="margin-top:10px">Re-charter (${fmt(ct.BANK_FOUND_COST)})</button></div>`;
  return `
  <div class="tiles">${tile('DEPOSITS', 'b_d')}${tile('RESERVE RATIO', 'b_r')}${tile('RUN RISK', 'b_run')}</div>
  <div class="card"><h3>MONETARY CONTROL ${ta('reserveratio')}</h3>
    <div class="row"><span class="dim" style="width:118px">Deposit rate</span>
      <input id="rate" value="${b.rate.toFixed(2)}" style="width:76px" inputmode="decimal" /> <span class="dim">%</span>
      <button class="chip" data-act="rateSet">SET</button></div>
  </div>
  <div class="card"><h3>UNDERWRITING POLICY</h3>
    <div class="segrow">
      ${['secured', 'balanced', 'predatory'].map((m) => `<button class="spd ${b.underwrite === m ? 'on' : ''}" data-act="policy:${m}">${m.toUpperCase()}</button>`).join('')}
    </div>
    <p class="opnote">Predatory: fat margins, hot default fires. Secured: thin and safe.</p></div>
  <div class="card"><h3>RECAPITALIZE</h3>
    <div class="row"><input id="rcam" type="number" placeholder="USD" style="flex:1" inputmode="decimal" />
      <button class="chip" data-act="chip:rcam:0.25">¼</button>
      <button class="chip" data-act="chip:rcam:1">MAX</button></div>
    <div class="row"><button class="btn" data-act="recap">Recapitalize</button></div></div>
  <details class="sec" open><summary>💼 LOAN BOOK</summary><div id="u_loans"></div></details>
  <details class="sec"><summary>🏦 RUN RISK MODEL</summary>
    <p class="opnote">Reserves are drained each tick by service flows ${ta('runrisk')}; when a run drains more than your reserves the bank collapses and the government bails you out publicly.</p>
  </details>`;
}
export function bankUpd(s) {
  const b = P(s).bank;
  if (!b) {
    // no-bank hero: cheapest facts up top
    setT(el('b_d0'), fmt(0));
    setT(el('b_x'), 'NONE');
    setT(el('b_c'), fmt(ct.BANK_FOUND_COST));
    return;
  }
  if (b.failed) { setT(el('b_d0'), fmt(0)); setT(el('b_x'), 'BANKRUPT'); setT(el('b_e'), fmt(0)); return; }
  setT(el('b_d'), fmt(b.deposits));
  const rr = b.reserve / Math.max(1, b.deposits);
  const rrEl = el('b_r');
  setT(rrEl, pct(rr, 0));
  rrEl.className = rr < 0.25 ? 'down' : rr < 0.45 ? 'warn' : 'up';
  const rk = el('b_run');
  setT(rk, pct(b.runRisk, 0));
  rk.className = b.runRisk > 0.6 ? 'down' : b.runRisk > 0.3 ? 'warn' : 'up';
  const loans = el('u_loans');
  if (loans) {
    put(loans, b.loanBook.length
      ? `<div class="sc cardify"><table><tr><th>Borrower</th><th>Principal</th><th>Rate</th><th>Risk</th></tr>
        ${b.loanBook.slice(-10).reverse().map((l) => `<tr>
          <td data-l="Borrower">${esc(l.borrower)}</td>
          <td data-l="Principal" class="mono">${fmt(l.principal)}</td>
          <td data-l="Rate" class="mono">${pct(l.rate, 0)}</td>
          <td data-l="Risk" class="risk ${l.risk > 0.6 ? 'down' : 'dim'}">${pct(l.risk, 0)}</td></tr>`).join('')}
      </table></div>`
      : emptyB('No active loans — set a sharper policy or wait for the book to grow.'));
  }
}

// ================= PAGE: CRYPTO LAB =================
export function labHtml(s) {
  const mine = s.tokens.filter((t) => t.creator === s.name);
  return `
  <div class="tiles">${tile('MY COINS', 'l_mc')}${tile('LP POOLS — MY', 'l_lp')}${tile('STAKED VALUE', 'l_st')}</div>
  <div class="primary">
    <button class="btn" data-act="wizOpen:token">🧪 Mint a token</button>
  </div>
  <details class="sec" open><summary>⚗️ POOL OPS ${ta('lp')} ${ta('amm')}</summary><div id="u_pools">${mine.length ? labPools(s) : emptyB('No coins yet — mint one to unlock pools, staking and shenanigans.')}</div></details>
  <details class="sec"><summary>🚨 HIGH-VOLATILITY OPS</summary>
    <div class="grid g2">
      <div class="card"><h3>FLASH-LOAN ATTACK ${ta('slippage')}</h3>
        <p class="dim" style="font-size:11.5px">Borrow, dump huge, repay inside one tick. If MEV bots front-run you, you eat a liquidation.</p>
        <div class="row"><select id="flTarget">${s.tokens.filter((t) => !t.rugPulled).map((t) => `<option>${t.sym}</option>`).join('')}</select>
          <button class="btn danger" data-act="flash">⚡ EXECUTE</button></div></div>
      <div class="card"><h3>RUG PULL ${ta('rug')}</h3>
        <p class="dim" style="font-size:11.5px">Drain your own pool into dirty cash. Instant +38 heat. <span class="tip" data-tip="${esc(TIPS.heat)}">ⓘ</span></p>
        <div class="row"><select id="rugTarget">${mine.map((t) => `<option>${t.sym}</option>`).join('') || '<option disabled>none</option>'}</select>
          <button class="btn danger" data-act="rug" ${mine.length ? '' : 'disabled'}>💀 RUG IT</button></div></div>
    </div></details>`;
}
function labPools(s) {
  const mine = s.tokens.filter((t) => t.creator === s.name);
  return mine.map((t) => `
  <div class="row-item" style="align-items:flex-start;flex-direction:column">
    <div class="row" style="width:100%"><span class="sym mono">${t.sym}</span><span class="dim" id="pl_p_${t.sym}">${fmt(price(t))}</span>
      ${t.rugPulled ? '<span class="pill r">DEAD</span>' : ''}
      <span class="rt mono dim" id="pl_pc_${t.sym}">pool ${fmt(t.pool.cash)}</span></div>
    ${t.rugPulled ? '' : `
    <div class="row" style="width:100%"><input id="lp_${t.sym}" type="number" placeholder="USD into pool" style="flex:1" inputmode="decimal" />
      <button class="chip" data-act="addLp:${t.sym}">Add LP</button>
      <button class="chip" data-act="rmLp:${t.sym}">Exit LP</button></div>
    <div class="row" style="width:100%">
      ${(P(s).tok[t.sym] || 0) > 0 ? `<button class="chip" data-act="stakeIt:${t.sym}">Stake bag (${cfmt(P(s).tok[t.sym])})</button>` : ''}
      ${(P(s).staked[t.sym] || 0) > 0 ? `<button class="chip" data-act="unStake:${t.sym}">Unstake (${cfmt(P(s).staked[t.sym])})</button>` : ''}
      <span class="dim" style="font-size:10.5px">${P(s).lp[t.sym] ? 'LP ' + fmt(P(s).lp[t.sym]) + ' +2% exit fees' : ''}${(P(s).staked[t.sym] || 0) > 0 ? ` · staked @ ${fmt(price(t))}` : ''}</span>
    </div>`}
  </div>`).join('') || emptyB('No coins yet — mint one first.');
}
export function labUpd(s) {
  const mine = s.tokens.filter((t) => t.creator === s.name && !t.rugPulled);
  setT(el('l_mc'), mine.length);
  setT(el('l_lp'), fmt(s.tokens.reduce((a, t) => a + (P(s).lp[t.sym] || 0), 0)));
  setT(el('l_st'), fmt(s.tokens.reduce((a, t) => a + (P(s).staked[t.sym] || 0) * price(t), 0)));
  const pools = el('u_pools');
  if (pools && mine.length) put(pools, labPools(s));
}

// ================= PAGE: MEDIA EMPIRE =================
export function mediaHtml(s) {
  const M = P(s).media;
  if (!M) return `
  <div class="tiles">${tile('REACH', 'm_r')}${tile('EPISODES', 'm_e')}${tile('FCC HEAT', 'm_f')}</div>
  <div class="card sel"><h3>FOUND A NETWORK ${ta('reach')}</h3>
    <p class="dim" style="font-size:12px">Reach = share of the population watching you. It drives ad revenue, sentiment control … and dark ops: propaganda and slander at industrial scale.</p>
    <button class="btn gold" data-act="wizOpen:tv" style="margin-top:10px">📺 TV network wizard</button></div>`;
  return `
  <div class="tiles">${tile('REACH', 'm_r')}${tile('EPISODES', 'm_e')}${tile('FCC HEAT', 'm_f')}</div>
  <div class="card"><h3>PROGRAMMING GRID — ${esc(M.name)}</h3>
    <div id="u_shows">${M.shows.length ? mediaShows(s) : emptyB('No shows yet. Greenlight one below 🎬')}</div>
    <div class="chiprow" style="margin-top:10px">
      ${[['shill', '🚀 Shillcast ' + fmt(md.SHOW_COST.shill)], ['talk', '🎙️ Talk ' + fmt(md.SHOW_COST.talk)], ['drama', '🎬 Drama ' + fmt(md.SHOW_COST.drama)], ['news', '📰 News ' + fmt(md.SHOW_COST.news)]].map(([t, l]) => `<button class="chip" data-act="show:${t}">${l}</button>`).join('')}
    </div></div>
  <details class="sec"><summary>🎭 DARK OPS — NARRATIVE WARFARE ${ta('fcc')}</summary>
    <div class="card"><div class="row"><select id="smTarget" style="flex:1">${s.corps.filter((c) => c.alive).map((c) => `<option>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="row">
        <button class="btn" data-act="smear:real">📰 Exposé ($500K)</button>
        <button class="btn danger" data-act="smear:fake">🎭 Fake news ($500K)</button></div>
      <p class="opnote">Fabrics hit twice as hard but raise FCC heat; ${(s.gov.mediaGag || 0) ? '<span class="warn">TRUTH-IN-BROADCAST ACT active — ops weakened 50%</span>' : 'no broadcast restrictions'}</p></div>
  </details>`;
}
function mediaShows(s) {
  const M = P(s).media;
  return M.shows.map((sh) => `<div class="row-item"><div style="flex:1;min-width:0">
    <b class="mono" style="color:var(--acc2)">${esc(sh.name)}</b> <span class="pill">${sh.type}</span>
    <div class="dim" style="font-size:10.5px">ep# ${sh.ep} · exposure ${'▮'.repeat(Math.round(clamp(sh.buzz / 3 * 10, 0, 10)))}</div></div>
    <button class="btn" data-act="air:${sh.id}">Air #${sh.ep + 1}</button></div>`).join('');
}
export function mediaUpd(s) {
  const M = P(s).media;
  if (!M) { setT(el('m_r'), '0%'); setT(el('m_e'), '0'); setT(el('m_f'), '0'); return; }
  setT(el('m_r'), pct(M.reach, 0));
  setT(el('m_e'), M.episodes);
  const f = el('m_f');
  setT(f, M.fccHeat.toFixed(1));
  f.className = M.fccHeat > 2 ? 'down' : M.fccHeat > 1 ? 'warn' : 'up';
  const shows = el('u_shows');
  if (shows && M.shows.length) put(shows, mediaShows(s));
}

// ================= PAGE: UNDERWORLD =================
export function crimeHtml(s) {
  return `
  <div class="tiles">${tile('DIRTY CASH', 'cr_d')}${tile('MERC CREWS', 'cr_h')}${tile('HEAT', 'cr_ht')}</div>
  <div class="card sel"><h3>🧼 LAUNDER ${ta('heat')}</h3>
    <div class="row"><input id="lau" type="number" min="0" placeholder="amount" style="flex:1" inputmode="decimal" />
      <button class="chip" data-act="chip:lau:0.25">¼</button>
      <button class="chip" data-act="chip:lau:0.5">½</button>
      <button class="chip" data-act="chip:lau:1">MAX</button></div>
    <div class="row"><button class="btn" data-act="launder" style="flex:1">🧼 Launder now</button></div>
    <p class="opnote" id="cr_note"></p></div>
  <div class="primary">
    <button class="btn" data-act="wizOpen:gang">🔫 Retain merc — ${fmt(350000)}</button>
    <button class="btn" data-act="smuggle">📦 Smuggle run</button>
  </div>
  <div class="card"><h3>🔐 CORPORATE HEIST</h3>
    <div class="row"><select id="htTarget" style="flex:1">${s.corps.filter((c) => c.alive).map((c) => `<option>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="row"><button class="btn danger" data-act="heist" style="flex:1">Execute heist</button></div></div>
  <div class="card"><h3>🤝 SPECIAL RELATIONSHIPS</h3>
    <div class="row"><input id="bri" type="number" placeholder="bribe $ (min 50K)" style="flex:1" inputmode="decimal" />
      <button class="chip" data-act="chip:bri:0.25">¼</button>
      <button class="chip" data-act="chip:bri:1">MAX</button></div>
    <div class="row"><button class="btn gold" data-act="bribe" style="flex:1">Pay consultants 🤝</button></div></div>
  <details class="sec"><summary>📊 OPERATION ANATOMY</summary>
    <p class="opnote">Launder fee starts at 12% and scales with heat (belt up to 27%). Bust chance scales with heat, amount share and the Privacy Act. Loot from heists lands 30% clean / 70% dirty.</p>
    <div class="row">
      <span class="pill">ops laundered: ${fmt(s.stats.laundered)}</span>
      <span class="pill r">heists won: ${s.stats.hackerWins}</span>
      <span class="pill y">bribes paid: ${s.stats.bribes}</span>
    </div>
  </details>`;
}
export function crimeUpd(s) {
  setT(el('cr_d'), fmt(P(s).dirty));
  setT(el('cr_h'), P(s).hackers || 0);
  const ht = el('cr_ht');
  setT(ht, pct(P(s).heat / 100, 0));
  ht.className = P(s).heat > 70 ? 'down' : P(s).heat > 40 ? 'warn' : 'up';
  const note = el('cr_note');
  if (note) {
    const fee = 0.12 + P(s).heat / 100 * 0.15;
    put(note, `at your heat you pay ${(fee * 100).toFixed(0)}% fee ${ta('heat')}; MAX now ≈ ${fmt(P(s).dirty)} · bust risk ${pct(clamp(0.05 + P(s).heat / 260, 0.02, 0.6), 0)}`);
  }
}

// ================= PAGE: GOVERNMENT =================
export function govHtml(s) {
  const law = s.gov.pending;
  return `
  <div class="tiles">${tile('TRANSACTION TAX', 'g_tax')}${tile('WARRANTS', 'g_w')}${tile('BAILOUTS', 'g_b')}</div>
  <div class="card ${law ? 'sel' : ''}" id="u_lawcard">${law ? govLaw(s) : govNoLaw(s)}</div>
  <details class="sec"><summary>🏛️ STATE OF THE STATE</summary>
    <div class="row">
      <span class="pill y">tax ${(s.gov.tax * 100).toFixed(0)}%</span>
      <span class="pill ${s.gov.warrants ? 'r' : 'g'}">warrants ${s.gov.warrants}</span>
      <span class="pill">bailouts ${s.gov.bailouts}</span>
      ${s.gov.privacy ? '<span class="pill v">Privacy Deregulation</span>' : ''}
    </div>
    <p class="opnote">${s.gov.law ? `Current regime: <b>${esc(s.gov.law.name)}</b> — ${esc(s.gov.law.desc)}` : 'No landmark law on the books yet.'}</p>
  </details>`;
}
function govLaw(s) {
  const law = s.gov.pending;
  return `<h3>SENATE DOCKET ${ta('support')}</h3>
    <p><b class="mono" style="color:var(--acc)">${esc(law.name)}</b></p>
    <p class="dim" style="font-size:12px;margin:4px 0 10px">${esc(law.desc)}</p>
    <span class="risk">SUPPORT ${(law.support * 100).toFixed(0)}%</span>
    <div class="meter"><i class="${law.support > 0.5 ? 'r' : 'g'}" style="width:${law.support * 100}%"></i></div>
    <div class="row" style="margin-top:10px"><input id="lob" type="number" placeholder="lobby $ (min 10K)" style="flex:1" inputmode="decimal" />
      <button class="chip" data-act="chip:lob:0.25">¼</button>
      <button class="chip" data-act="chip:lob:1">MAX</button></div>
    <div class="row"><button class="btn gold" data-act="lobby" style="flex:1">💼 Lobby against</button></div>
    <p class="opnote">Lobbying shifts senators against the docket — small chance of an OCU sting (heat +22).</p>`;
}
function govNoLaw(s) {
  return `<h3>SENATE — RECESS</h3><p class="dim">The Senate is drafting in committees. Docket opens soon — heat your checkbooks.</p>`;
}
export function govUpd(s) {
  setT(el('g_tax'), pct(s.gov.tax, 0));
  const w = el('g_w');
  setT(w, s.gov.warrants);
  w.className = s.gov.warrants ? 'down' : 'up';
  setT(el('g_b'), s.gov.bailouts);
  if (s.gov.pending) put(el('u_lawcard'), govLaw(s));
}

// ================= PAGE: GOD MODE =================
export function godHtml(s) {
  const hist = (s.ui && s.ui.term) || [];
  return `
  <div class="term"><div class="out" id="termOut" tabindex="-1">
    <div class="cmdline">&gt; god mode engaged (mirajx132@gmail.com)</div>
    ${hist.map((x) => `<div class="cmdline">&gt; ${esc(x.c)}</div><div>${esc(x.out)}</div>`).join('')}
  </div>
  <form id="termForm"><input id="termIn" placeholder="help — list admin commands" autocomplete="off" /><button class="btn">EXEC</button></form>
  </div>
  <details class="sec"><summary>📖 COMMAND LIST</summary><pre class="opnote mono" style="white-space:pre-wrap">${GOD_HELP.map((x) => esc(x)).join('\n')}</pre></details>`;
}
export function godUpd() { /* terminal is input-driven; nothing live */ }

// ================= PAGE BUS =================
const PGS = {
  dash:  { b: dashHtml,  u: dashUpd },
  trade: { b: tradeHtml, u: tradeUpd },
  city:  { b: cityHtml,  u: cityUpd },
  bank:  { b: bankHtml,  u: bankUpd },
  lab:   { b: labHtml,   u: labUpd },
  media: { b: mediaHtml, u: mediaUpd },
  crime: { b: crimeHtml, u: crimeUpd },
  gov:   { b: govHtml,   u: govUpd },
  wire:  { b: () => '',   u: () => {} },
  god:   { b: godHtml,   u: godUpd },
};
const wirePage = {
  b: (s) => `
  <div class="chiprow">
    ${['all', 'market', 'scandal', 'info'].map((k) => `<button class="chip ${(s.ui.wf || 'all') === k ? 'on' : ''}" data-act="wf:${k}">${k.toUpperCase()}</button>`).join('')}
  </div>
  <div class="card" style="margin-top:10px"><div class="feed" id="u_wire"></div></div>`,
  u: (s) => { const f = el('u_wire'); if (f) put(f, feedHtml(s, s.ui.wf || 'all')); },
};
PGS.wire = wirePage;

export function buildPage(s) {
  S = s;
  const r = PGS[s.ui.panel] || PGS.dash;
  const m = el('main');
  m.innerHTML = r.b(s);
  m.scrollTop = 0;
  r.u(s);
  drawAll();
}

export function tickPage(s) {
  S = s;
  const m = el('main');
  if (!m || !m.firstElementChild) { buildPage(s); return; }
  const r = PGS[s.ui.panel] || PGS.dash;
  try { r.u(s); } catch (e) { console.warn('page update failed', e); buildPage(s); }
  renderTop(s);
}

export function renderAll(s) {
  S = s;
  renderTop(s);
  renderNav(s);
  buildPage(s);
}

// ================= SHEETS / DRAWER / WIZARDS =================
export function openSheet(title, html) {
  el('sheetTitle').textContent = title;
  put(el('sheetBody'), html);
  el('sheet').classList.add('open');
}

export function closeSheet() { el('sheet').classList.remove('open'); }
export function sheetOpen() { return el('sheet').classList.contains('open'); }

export function toggleDrawer() {
  const d = el('drawer');
  const opening = !d.classList.contains('open');
  if (opening) clearUnread();
  d.classList.toggle('open', opening);
  if (opening) renderDrawer();
}
export function closeDrawer() { el('drawer').classList.remove('open'); }

export function renderDrawer(s) {
  const list = el('toasts');
  const meta = el('notiMeta');
  const notis = getNotis();
  setT(meta, `${notis.length} notification${notis.length === 1 ? '' : 's'} · ${unreadCount()} unread`);
  if (list) {
    put(list, notis.slice(-40).reverse().map((n) =>
      `<div class="post ${n.kind}"><span class="t">${new Date(n.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${esc(n.text)}</div>`).join('')
      || emptyB('No notifications yet.'));
  }
}

// ---------------- More sheet ----------------
export function moreSheet(s) {
  const pages = (s.god ? [...PANELS, { id: 'god', ic: '🔥', name: 'God Mode', tag: 'admin' }] : PANELS).filter((p) => p.id !== 'more');
  openSheet('ALL PAGES', `
    <input class="navsearch" id="mssearch" placeholder="🔎 Find page…" data-r="sheetsearch" />
    <div class="moregrid" id="moreGrid">
      ${pages.map((p) => `<button class="morecell" data-act="go:${p.id}" data-name="${esc(p.name)}" data-tag="${esc(p.tag || '')}">
        <span class="ic">${p.ic}</span><span>${esc(p.name)}</span></button>`).join('')}
    </div>
    <p class="opnote">Tip: the search filters by name or keyword (e.g. "loan", "rug", "law").</p>`);
}
function filterSheet(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#moreGrid .morecell').forEach((n) => {
    n.style.display = (!q || (n.dataset.name || '').toLowerCase().includes(q) || (n.dataset.tag || '').includes(q)) ? '' : 'none';
  });
}

// ---------------- WIZARDS ----------------
const FIELDS = {
  sym: { l: 'SYMBOL', t: 'text', ph: 'e.g. NYXC', hint: '2–6 letters A-Z0-9' },
  cname2: { l: 'COIN NAME', t: 'text', ph: 'e.g. Nyx Chain' },
  supply: { l: 'TOTAL SUPPLY', t: 'number', v: 100000000 },
  liq: { l: 'SEED LIQUIDITY (USD)', t: 'number', v: 250000, hint: 'Goes into the AMM pool; you keep 50% of supply.' },
  bankname: { l: 'BANK NAME (optional)', t: 'text', ph: 'default: your name + Trust' },
  corpname: { l: 'COMPANY NAME', t: 'text', ph: 'e.g. Vanguard Systems' },
  netname: { l: 'NETWORK NAME (optional)', t: 'text', ph: 'default: your name + Broadcasting' },
};

const WIZERS = {
  token: { title: '🧪 MINT A TOKEN',
    steps: [{ h: 'Identity', f: ['sym', 'cname2'] }, { h: 'Liquidity', f: ['supply', 'liq'] }, { h: 'Review' }],
    cost: (v) => { const liq = clamp(num(v.liq, 250000), 1000, 1e15); return [['Seed liquidity', fmt(liq)], ['Supply', cfmt(num(v.supply, 1e8))], ['You keep', '50% of supply'], ['Upfront risk', 'none (pool is yours)']]; },
    do: (s, v) => mk.mintToken(s, { sym: v.sym, name: v.cname2, supply: num(v.supply, 1e8), liquidity: num(v.liq, 250000) }) },
  bank: { title: '🏦 CHARTER A BANK',
    steps: [{ h: 'Name', f: ['bankname'] }, { h: 'Review' }],
    cost: () => [['Charter', fmt(ct.BANK_FOUND_COST)], ['Depositors', 'seeded local base (~$3–6M deposits)'], ['Interest you pay', 'your chosen rate'], ['Danger', 'thin reserves → bank run']] ,
    do: (s, v) => ct.foundBank(s, v.bankname) },
  ipo: { title: '💼 TAKE COMPANY PUBLIC',
    steps: [{ h: 'Name', f: ['corpname'] }, { h: 'Review' }],
    cost: () => [['IPO fee', fmt(mk.FOUND_COST)], ['Float', '120M shares @ $10'], ['Your stake', '100% at listing'], ['Reputation', '+6']] ,
    do: (s, v) => mk.foundCorp(s, v.corpname) },
  tv: { title: '📺 LAUNCH TV NETWORK',
    steps: [{ h: 'Name', f: ['netname'] }, { h: 'Review' }],
    cost: () => [['Broadcast license', fmt(md.NETWORK_COST)], ['Reach', 'starts at 5%'], ['Episodes', 'cost per show extra'], ['Reputation', '+ ad revenue']] ,
    do: (s, v) => md.foundNetwork(s, v.netname) },
  gang: { title: '💀 RETAIN A MERC CREW',
    steps: [{ h: 'Retainer', f: [] }, { h: 'Review' }],
    cost: () => [['Retainer', fmt(350000)], ['Unlocks', 'corporate heists'], ['Heat', '+4 immediately'], ['Note', 'crews can be lost on failed ops']] ,
    do: (s) => ac.hireHacker(s) },
};

let W = null; // {id, step, vals:{}}

export function wizOpen(id) {
  const def = WIZERS[id];
  if (!def) return;
  W = { id, step: 1, vals: {} };
  wizRender();
}
function wizStepHTML() {
  const def = WIZERS[W.id];
  const st = def.steps[W.step - 1];
  const dots = def.steps.map((_, i) => `<span class="wdot ${i + 1 === W.step ? 'on' : i + 1 < W.step ? 'done' : ''}"></span>`).join('');
  let body = `<div class="wz-steps">${dots}</div><h3 class="wz-h">${st.h}</h3>`;
  if (st.f) {
    body += st.f.map((k, i) => {
      const f = FIELDS[k];
      const v = W.vals[k] ?? (f.v != null ? f.v : '');
      return `<div class="field"><label for="wz_${i}">${f.l}</label>
        <input id="wz_${i}" type="${f.t}" data-wf="${k}" value="${esc(v)}" placeholder="${f.ph || ''}" inputmode="${f.t === 'number' ? 'decimal' : 'text'}"/>
        ${f.hint ? `<p class="opnote">${f.hint}</p>` : ''}</div>`;
    }).join('');
  } else if (st.h.toLowerCase().includes('review') || st.h === 'Retainer') {
    const rows = def.cost(W.vals);
    body += `<div class="preview">${rows.map(([a, b]) => `<div class="pvrow"><span>${a}</span><b class="mono">${b}</b></div>`).join('')}</div>
      <p class="opnote">Confirming executes the transaction and autosaves afterwards.</p>`;
  }
  body += `<div class="row" style="margin-top:12px">
    ${W.step > 1 ? '<button class="btn" data-act="wizBack">‹ Back</button>' : '<button class="btn" data-act="wizClose">Cancel</button>'}
    <span class="spacer"></span>
    ${W.step < def.steps.length ? '<button class="btn" data-act="wizNext">Next ›</button>' : `<button class="btn gold" data-act="wizGo">✔ CONFIRM</button>`}
  </div>`;
  return body;
}
export function wizRender() {
  const def = WIZERS[W.id];
  openSheet(def.title, wizStepHTML());
}
export function wizActive() { return !!W; }
export function wizNext() {
  if (!W) return;
  wizCapture();
  const def = WIZERS[W.id];
  if (W.step < def.steps.length) { W.step += 1; wizRender(); }
}
export function wizBack() {
  if (!W) return;
  const def = WIZERS[W.id];
  if (W.step > 1) { W.step -= 1; wizRender(); }
  else wizClose();
}
export function wizCapture() {
  const def = WIZERS[W.id];
  const st = def.steps[W.step - 1];
  if (st.f) st.f.forEach((k, i) => { const inp = el('wz_' + i); if (inp) W.vals[k] = inp.value; });
}
export function wizGo(s) {
  const def = WIZERS[W.id];
  wizCapture();
  let res;
  try { res = def.do(s, W.vals); } catch (e) { res = { ok: false, msg: 'Engine error: ' + e.message }; }
  toast(res.msg || (res.ok ? 'Done.' : 'Blocked.'), res.ok ? 'ok' : 'bad');
  if (res.ok) { W = null; closeSheet(); renderAll(s); }
  else { W.step = Math.max(1, def.steps.length - 1); wizRender(); }
}
export function wizClose() { W = null; closeSheet(); }

// ---------------- per-tick page update ----------------
export function tickPageEntry(s) { tickPage(s); }

// ---------------- init ----------------
export function init() {
  // input delegation: previews + searches
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id === 'opBuy' || t.id === 'opSell') { if (S) tradePrev(S); return; }
    if (t.dataset.r === 'navsearch') { filterNav(t.value); return; }
    if (t.dataset.r === 'sheetsearch') { filterSheet(t.value); return; }
  });
  // tooltip tap-toggle (touch) — hover works on pointer devices
  document.addEventListener('click', (e) => {
    const tip = e.target.closest('.tip');
    document.querySelectorAll('.tip.open').forEach((x) => { if (x !== tip) x.classList.remove('open'); });
    if (tip) tip.classList.toggle('open');
  });
  window.addEventListener('omni-noti', () => { if (S) renderTop(S); });
  window.addEventListener('omni-noti', () => { NAV_SIG = ''; if (S) renderNav(S); }); // bell badge
}
