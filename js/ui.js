/* OMNILIFE UI: topbar, navigation, every panel, charts, input delegation.
 * Full re-render of the active panel each sim tick with focus preservation. */

import { fmt, cfmt, num, clamp, esc, pct, el, h } from './util.js';
import { P, price, netWorth } from './state.js';
import * as mk from './market.js';
import * as ct from './city.js';
import * as md from './media.js';
import * as ac from './actions.js';
import * as gd from './god.js';

export const PANELS = [
  { id: 'dash', ic: '📊', name: 'Command' },
  { id: 'trade', ic: '💠', name: 'DEX & Markets' },
  { id: 'lab', ic: '🧪', name: 'Crypto Lab' },
  { id: 'city', ic: '🏙️', name: 'City & ISP' },
  { id: 'bank', ic: '🏦', name: 'Banking' },
  { id: 'media', ic: '📺', name: 'Media Empire' },
  { id: 'crime', ic: '💀', name: 'Underworld' },
  { id: 'gov', ic: '🏛️', name: 'Government' },
  { id: 'wire', ic: '📡', name: 'The Wire' },
];

// ---------------- shared bits ----------------
const kpi = (label, val, cls = '') =>
  `<div class="card kpi-card"><b class="${cls}">${val}</b><span>${label}</span></div>`;

const meter = (frac, cls = 'c') =>
  `<div class="meter"><i class="${cls}" style="width:${clamp(frac, 0, 1) * 100}%"></i></div>`;

const chg = (hist, n = 8) => {
  const h = hist.slice(-n);
  if (h.length < 2) return 0;
  const a = h[0], b = h[h.length - 1];
  return (b - a) / Math.max(1e-12, a);
};
const chgFmt = (v) => `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v * 100).toFixed(1)}%</span>`;

function canvasHist(hist, cls, color, fill) {
  const data = hist.slice(-120).map((v) => (Number.isFinite(v) ? +v.toPrecision(5) : 0));
  return `<canvas class="${cls}" data-hist="${data.join(',')}" data-color="${color}" ${fill ? 'data-fill="1"' : ''}></canvas>`;
}

function drawAll() {
  document.querySelectorAll('canvas[data-hist]').forEach((cv) => {
    const data = (cv.dataset.hist || '').split(',').filter((x) => x !== '').map(Number);
    if (data.length < 2) return;
    const w = cv.clientWidth || 300;
    const hgt = cv.clientHeight || 44;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = hgt * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const min = Math.min(...data), max = Math.max(...data);
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.05 || 1;
    const lo = min - pad, hi = max + pad;
    const X = (i) => (i / (data.length - 1)) * (w - 2) + 1;
    const Y = (v) => hgt - 3 - ((v - lo) / (hi - lo)) * (hgt - 6);
    const color = cv.dataset.color || '#22d3ee';
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

// ---------------- topbar & nav ----------------
export function renderTop(s) {
  const day = Math.floor(s.tick / 48) + 1;
  const hour = Math.floor(((s.tick % 48) / 2) + 6) % 24;
  const nw = netWorth(s);
  el('topbar').innerHTML = `
    <div class="logo"><span class="dot"></span>OMNILIFE</div>
    <div class="stat"><b class="mono">${day}d ${String(hour).padStart(2, '0')}:00</b><span>Sector-7</span></div>
    <div class="stat"><b class="mono">${fmt(nw)}</b><span>Net worth</span></div>
    <div class="stat"><b class="mono up">${fmt(P(s).cash)}</b><span>Clean cash</span></div>
    <div class="stat"><b class="mono down">${fmt(P(s).dirty)}</b><span>Dirty cash</span></div>
    <div class="stat"><b class="mono">${pct(P(s).heat / 100, 0)}</b><span>Police heat</span>
      <div class="heatbar"><i style="width:${P(s).heat}%"></i></div></div>
    <div class="spacer"></div>
    <div class="row" style="margin:0">
      ${[0, 1, 2, 4].map((x) => `<button class="spd ${s.speed === x ? 'on' : ''}" data-act="speed:${x}">${x === 0 ? '❚❚' : x + '×'}</button>`).join('')}
      <button class="spd" data-act="newgame">⟲ New</button>
    </div>`;
}

export function renderNav(s) {
  const nav = PANELS.filter((x) => x);
  if (s.god) nav.push({ id: 'god', ic: '🔥', name: 'God Terminal' });
  el('side').innerHTML = nav.map((p) => {
    let badge = '';
    if (p.id === 'gov' && s.gov.warrants > 0) badge = `<span class="badge">⚖${s.gov.warrants}</span>`;
    if (p.id === 'crime' && P(s).dirty > 1000) badge = `<span class="badge">$</span>`;
    return `<button class="nav ${s.ui.panel === p.id ? 'on' : ''}" data-act="go:${p.id}">
      <span class="ic">${p.ic}</span><span>${p.name}</span>${badge}</button>`;
  }).join('');
}

// ---------------- panels ----------------
export function renderPanel(s) {
  const v = {
    dash: vDash, trade: vTrade, lab: vLab, city: vCity, bank: vBank,
    media: vMedia, crime: vCrime, gov: vGov, wire: vWire, god: vGod,
  }[s.ui.panel] || vDash;
  const main = el('main');
  // focus preservation across re-renders
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : '';
  const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
  main.innerHTML = v(s);
  drawAll();
  if (focusId) {
    const target = document.getElementById(focusId);
    if (target) {
      target.focus();
      try { target.setSelectionRange(selStart, selStart); } catch {}
    }
  }
}

const head = (t, sub) => `<div class="phead"><h2>${t}</h2><p>${sub || ''}</p></div>`;

// ---- dashboard ----
function vDash(s) {
  const p = P(s);
  const nw = netWorth(s);
  pushNet(s, nw);
  const movers = s.tokens.filter((t) => !t.rugPulled)
    .map((t) => ({ t, d: chg(t.hist, 12) }))
    .sort((a, b) => b.d - a.d);
  const risers = movers.slice(0, 3), fallers = movers.slice(-3).reverse();
  const holdings = s.tokens.filter((t) => (p.tok[t.sym] || 0) > 1e-9)
    .map((t) => `<tr><td><span class="sym">${t.sym}</span></td><td class="mono">${cfmt(p.tok[t.sym])}</td>
    <td class="mono">${fmt(price(t) * p.tok[t.sym])}</td><td>${chgFmt(chg(t.hist, 12))}</td></tr>`).join('');
  const shares = s.corps.filter((c) => (p.shares[c.id] || 0) > 0 && c.alive)
    .map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${cfmt(p.shares[c.id])}</td><td class="mono">${fmt(c.price * p.shares[c.id])}</td></tr>`).join('');
  const roles = [
    p.bank ? `<span class="pill g">BANK CEO</span>` : `<span class="pill">no charter</span>`,
    p.media ? `<span class="pill v">MEDIA MOGUL</span>` : `<span class="pill">not on air</span>`,
    p.hackers > 0 ? `<span class="pill r">${p.hackers} merc crews</span>` : `<span class="pill">clean hands</span>`,
    p.racks > 1 ? `<span class="pill c">${p.racks} racks ⚡</span>` : `<span class="pill">${p.racks} rack ⚡</span>`,
  ].join(' ');

  return head('COMMAND DECK', 'Live server telemetry & your empire at a glance') + `
  <div class="grid g4">${kpi('Net worth', fmt(nw), 'up')}${kpi('Clean', fmt(p.cash))}${kpi('Dirty', fmt(p.dirty), 'down')}${kpi('Heat', pct(p.heat / 100, 0), p.heat > 70 ? 'down' : '')}</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>MARKET MOVERS <span class="rt">gas ${'$' + s.market.gasFee}</span></h3>
      <table><tr><th>🚀 Pumping</th><th></th></tr>
      ${risers.map((m) => `<tr><td><span class="sym">${m.t.sym}</span> ${esc(m.t.name)}</td><td class="mono">${chgFmt(m.d)}</td></tr>`).join('')}
      <tr><th style="padding-top:12px">🩸 Bleeding</th><th></th></tr>
      ${fallers.map((m) => `<tr><td><span class="sym">${m.t.sym}</span> ${esc(m.t.name)}</td><td class="mono">${chgFmt(m.d)}</td></tr>`).join('')}
      </table></div>
    <div class="card"><h3>YOUR POSITIONS</h3>${holdings ? `<table>${holdings}</table>` : '<p class="dim">No tokens. Head to the DEX.</p>'}
      ${shares ? `<table style="margin-top:10px">${shares}</table>` : ''}
      <div class="row" style="margin-top:12px">${roles}</div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>EMPIRE LOG</h3><div class="log">${s.log.slice(-40).reverse().map((l) => `<div><span class="t">${l.t}</span>${esc(l.text)}</div>`).join('') || '<div class="dim">World silence…</div>'}</div></div>
    <div class="card"><h3>THE WIRE — LIVE <span class="rt">${s.wire.length} posts</span></h3><div class="feed">${s.wire.slice(-10).reverse().map(wirePost).join('')}</div></div>
  </div>`;
}

function pushNet(s, nw) {
  s.hist = s.hist || [];
  s.hist.push(+nw.toPrecision(6));
  if (s.hist.length > 140) s.hist.shift();
}

const wirePost = (w) => `<div class="post ${w.kind}"><span class="t">d${Math.floor(w.t / 48) + 1}</span><b>${w.kind === 'market' ? 'TAPE' : w.kind === 'scandal' ? 'ACTION' : 'LORE'}</b> ${esc(w.text)}</div>`;

// ---- trade ----
function vTrade(s) {
  const sel = s.uiSel.sym || s.tokens[0]?.sym;
  const t = s.tokens.find((x) => x.sym === sel) || s.tokens[0];
  const held = P(s).tok[t.sym] || 0;
  const staked = P(s).staked[t.sym] || 0;
  const d12 = chg(t.hist, 12);
  return head('DEX & MARKETS', 'Constant-product AMM. Gas and congestion are real; slippage is real.') + `
  <div class="grid g2">
    <div class="card selgrad"><h3>${t.sym} <span class="rt">${esc(t.name)}</span></h3>
      <div class="row"><div class="bigflow mono">${fmt(price(t))}</div><div>${chgFmt(d12)}</div>
      ${t.rugPulled ? '<span class="pill r blink">RUGGED 💀</span>' : ''}
      ${staked > 0 ? `<span class="pill c">staked ${cfmt(staked)}</span>` : ''}</div>
      <canvas class="chartBig" data-hist="${t.hist.slice(-120).map((v) => +v.toPrecision(5)).join(',')}" data-color="#22d3ee" data-fill="1"></canvas>
      ${(P(s).lp[t.sym] ? `<p class="opnote">Your LP: ${fmt(P(s).lp[t.sym])} of pool ${fmt(t.pool.cash)}</p>` : '')}
      <div class="row" style="margin-top:10px">
        <input id="amtBuy" type="number" min="0" step="any" placeholder="USD amount" style="width:130px" />
        <button class="chip" data-act="chip:amtBuy:0.1">1/10</button>
        <button class="chip" data-act="chip:amtBuy:0.25">¼</button>
        <button class="chip" data-act="chip:amtBuy:1">MAX</button>
        <button class="btn" data-act="buy:${t.sym}">BUY ${t.sym}</button>
      </div>
      <div class="row">
        <input id="amtSell" type="number" min="0" step="any" placeholder="${t.sym} qty" style="width:130px" value="${held ? '' : ''}" />
        <button class="chip" data-act="chipu:amtSell:${t.sym}:0.25">¼ bag</button>
        <button class="chip" data-act="chipu:amtSell:${t.sym}:1">ALL ${held ? cfmt(held) : ''}</button>
        <button class="btn danger" data-act="sell:${t.sym}">SELL ${t.sym}</button>
      </div>
      <p class="opnote">Gas ${'$' + s.market.gasFee} · congestion ${(s.market.congestion * 100).toFixed(0)}% · tax ${(s.gov.tax * 100).toFixed(0)}% on gains only.</p>
    </div>
    <div class="card"><h3>EQUITY EXCHANGE <span class="rt">CEOs trade here too</span></h3>
      <div class="sc"><table><tr><th>Company</th><th>CEO</th><th>Price</th><th>Mkt Cap</th><th style="width:150px">Order</th></tr>
      ${s.corps.filter((c) => c.alive).map((c) => `<tr>
        <td><span class="sym">${esc(c.name)}</span><div class="dim" style="font-size:10px">${esc(c.sector)}</div></td>
        <td class="dim">${esc(c.ceo)}</td><td class="mono">${'$' + c.price.toFixed(2)}</td>
        <td class="mono">${fmt(c.price * c.shares)}</td>
        <td><div class="row" style="gap:4px">
          <input id="sh_${c.id}" type="number" min="0" placeholder="sh" style="width:74px"/>
          <button class="chip" data-act="shbuy:${c.id}">BUY</button>
          <button class="chip" data-act="shsell:${c.id}">SELL</button></div>
          ${P(s).shares[c.id] ? `<div class="dim" style="font-size:10px;margin-top:3px">hold ${cfmt(P(s).shares[c.id])} sh</div>` : ''}
        </td></tr>`).join('')}
      </table></div>
      <div class="row" style="margin-top:12px">
        <input id="corpName" placeholder="new company name" style="flex:1" />
        <button class="btn gold" data-act="foundCorp">IPO — ${fmt(mk.FOUND_COST)}</button>
      </div><p class="opnote">Going public: +6 reputation. Your shares trade under ${esc(s.corps.find((c) => c.playerOwned)?.name || '—')} once founded.</p>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>TOKEN BOARD</h3><div class="sc"><table>
    <tr><th>Asset</th><th>Price</th><th>24t</th><th>Pool depth</th><th>Your bag</th><th>Pick</th></tr>
    ${s.tokens.map((x) => `<tr class="${x.sym === t.sym ? 'sel' : ''}">
      <td><span class="sym">${x.sym}</span><div class="dim" style="font-size:10px">${esc(x.name)}${x.creator === s.name ? ' · MINE' : ''}</div></td>
      <td class="mono">${fmt(price(x))}</td><td>${chgFmt(chg(x.hist, 12))}</td>
      <td class="mono">${fmt(x.pool.cash)}</td>
      <td class="mono">${cfmt(P(s).tok[x.sym] || 0)}</td>
      <td><button class="chip" data-act="sel:${x.sym}">OPEN</button></td></tr>`).join('')}
  </table></div></div>`;
}

// ---- crypto lab ----
function vLab(s) {
  const mine = s.tokens.filter((t) => t.creator === s.name);
  return head('CRYPTO LAB', 'Mint meme coins, seed pools, stake, run liquidity — then decide whether to be honest or a monster.') + `
  <div class="grid g2">
    <div class="card"><h3>MINT A  TOKEN</h3>
      <div class="row"><input id="mSym" placeholder="SYMBOL" maxlength="6" style="width:110px" />
        <input id="mName" placeholder="Coin name" style="flex:1" /></div>
      <div class="row"><span class="dim" style="width:80px">Supply</span>
        <input id="mSupply" type="number" value="100000000" min="10000" style="flex:1" /></div>
      <div class="row"><span class="dim" style="width:80px">Seed liqui.</span>
        <input id="mLiq" type="number" value="250000" min="1000" style="flex:1" /></div>
      <div class="row"><button class="btn" data-act="mint">🚀 LAUNCH COIN</button>
        <span class="dim">You keep 50% of supply. Seed goes to the AMM pool.</span></div>
    </div>
    <div class="card"><h3>POOL OPS</h3>
      ${mine.length ? mine.map((t) => `
      <div class="card" style="padding:10px;margin-bottom:8px">
        <div class="row"><span class="sym">${t.sym}</span><span class="dim">${fmt(price(t))}</span>
          ${t.rugPulled ? '<span class="pill r">DEAD</span>' : ''}
          <span class="rt mono dim">pool ${fmt(t.pool.cash)}</span></div>
        ${t.rugPulled ? '' : `
        <div class="row">
          <input id="lp_${t.sym}" type="number" placeholder="USD" style="width:110px"/>
          <button class="chip" data-act="addLp:${t.sym}">Add LP</button>
          <button class="chip" data-act="rmLp:${t.sym}">Exit LP</button>
          ${(P(s).tok[t.sym] || 0) > 0 ? `<button class="chip" data-act="stakeIt:${t.sym}">Stake bag</button>` : ''}
          ${(P(s).staked[t.sym] || 0) > 0 ? `<button class="chip" data-act="unStake:${t.sym}">Unstake</button>` : ''}
        </div>`}
        <div class="row">
          ${P(s).lp[t.sym] ? `<span class="dim" style="font-size:11px">LP position ${fmt(P(s).lp[t.sym])} · fees on exit +2%</span>` : ''}
          ${(P(s).staked[t.sym] || 0) > 0 ? `<span class="dim" style="font-size:11px">staked ${cfmt(P(s).staked[t.sym])} @ ${fmt(price(t))}</span>` : ''}
        </div>
      </div>`).join('') : '<p class="dim">No created tokens yet.</p>'}
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>WEAPONS-GRADE DEF-I</h3>
    <div class="grid g2">
      <div>
        <p class="dim" style="font-size:12px">FLASH-LOAN ATTACK — borrow, dump huge, repay inside one tick. If MEV bots front-run you, you eat liquidation.</p>
        <div class="row"><select id="flTarget">${s.tokens.filter((t) => !t.rugPulled).map((t) => `<option>${t.sym}</option>`).join('')}</select>
          <button class="btn danger" data-act="flash">⚡ EXECUTE</button></div>
      </div>
      <div>
        <p class="dim" style="font-size:12px">RUG PULL — drain your own pool into dirty cash. Instant +38 heat. The Wire never forgets.</p>
        <div class="row"><select id="rugTarget">${mine.map((t) => `<option>${t.sym}</option>`).join('') || '<option disabled>none</option>'}</select>
          <button class="btn danger" data-act="rug" ${mine.length ? '' : 'disabled'}">💀 RUG IT</button></div>
      </div>
    </div>
  </div>`;
}

// ---- city & isp ----
function vCity(s) {
  const p = P(s);
  const ut = ct.ispUptime(s);
  return head('CITY & ISP BACKBONE', 'Lay fiber, host racks. Congestion decides gas fees; outages kill your mining.') + `
  <div class="grid g2">
    <div class="card"><h3>YOUR INTERNET EMPIRE</h3>
      <div class="row"><div class="stat"><b class="mono">${p.racks}</b><span>Server racks</span></div>
        <div class="stat"><b class="mono">${md9(ct.hashRate(s))} MH/s</b><span>Hash rate</span></div>
        <div class="stat"><b class="mono">${pct(ut, 0)}</b><span>Uptime</span></div>
        <div class="stat"><b class="mono">${s.city.districts.reduce((a, d) => a + d.fiber, 0)}</b><span>Fiber lines</span></div></div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-act="rack">＋ Rack — ${fmt(ct.RACK_COST * (p.racks + 1) ** 1.15)}</button>
        <button class="btn ${p.miningOn ? 'danger' : ''}" data-act="mine">${p.miningOn ? '⏸ Pause mining' : '⛏ Resume mining'}</button>
      </div>
      <p class="opnote">Congestion: ${(s.city.congestion * 100).toFixed(0)}% — ${s.city.congestion > 1.3 ? '<span class="warn">grid is drowning, gas + slippage spiking</span>' : 'healthy'}</p>
      ${p.outageTicks > 0 ? `<p class="warn blink" style="margin-top:8px">⚠️ OUTAGE IN PROGRESS — ${p.outageTicks} ticks remaining</p>` : ''}
      ${meter(s.city.congestion / 2, s.city.congestion > 1.3 ? 'r' : s.city.congestion > 0.8 ? 'a' : 'g')}
    </div>
    <div class="card"><h3>DISTRICTS OF SECTOR-7</h3><div class="sc"><table>
      <tr><th>District</th><th>Index</th><th>Crime</th><th>Sentiment</th><th colspan="2">Ops</th></tr>
      ${s.city.districts.map((d) => `<tr>
        <td>${d.emoji} ${esc(d.name)}<div class="dim" style="font-size:10px">${d.crime > 0.4 ? '<span class="warn">high crime</span>' : 'policed'} ${p.props[d.id] ? ` · your units: ${p.props[d.id]}` : ''}</div></td>
        <td class="mono">${(d.idx * 100).toFixed(0)}</td><td class="mono dim">${pct(d.crime, 0)}</td><td>${chgFmt(d.sentiment - 0.5)}</td>
        <td><button class="chip" data-act="prop:${d.id}">Buy ${fmt(ct.propPrice(d))}</button></td>
        <td><button class="chip" data-act="fiber:${d.id}">Fiber ${fmt(ct.fiberCost(d))}</button></td>
      </tr>`).join('')}</table></div>
      <p class="opnote">Rent income accrues hourly to clean cash: ${fmt(ct.rentIncome(s) / 48)} / tick when idle (see Empire Log).</p>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>REAL ESTATE PORTFOLIO <span class="rt">${s.city.districts.reduce((a, d) => a + (p.props[d.id] || 0), 0)} units</span></h3>
    <canvas class="chartBig" data-hist="${(s.city.districts[0]?.hist || [1]).map((v) => +v.toPrecision(5)).join(',')}" data-color="#c084fc" data-fill="1"></canvas>
    <p class="dim" style="margin-top:6px">Financial Quarter index over time. Property is the old money's game — crime and congestion bend the curve.</p>
  </div>`;
}

// ---- banking ----
function vBank(s) {
  const b = P(s).bank;
  return head('BANKING EMPIRE', 'Fractional reserves. Increase deposits flow, underwrite loans, pray for no run.') + (b && !b.failed ? `
  <div class="grid g4">
    ${kpi('Deposits', fmt(b.deposits))}${kpi('Reserves', fmt(b.reserve), b.reserve / b.deposits < 0.2 ? 'down' : 'up')}
    ${kpi('Book (lent)', fmt(b.lent))}${kpi('Equity', fmt(b.equity))}
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>MONETARY CONTROL</h3>
      <div class="row"><span class="dim" style="width:130px">Deposit rate</span>
        <input id="rate" value="${b.rate.toFixed(2)}" style="width:70px" /> <span class="dim">%</span>
        <button class="chip" data-act="rateSet">SET</button></div>
      <div class="row"><span class="dim" style="width:130px">Underwriting</span>
        ${['secured', 'balanced', 'predatory'].map((m) => `<button class="spd ${b.underwrite === m ? 'on' : ''}" data-act="policy:${m}">${m}</button>`).join('')}</div>
      <div class="row"><input id="rcam" type="number" placeholder="USD recap" style="width:150px" />
        <button class="btn" data-act="recap">Recapitalize</button></div>
      <div class="row" style="margin-top:14px"><div style="flex:1">
        <span class="risk ${b.runRisk > 0.6 ? 'down' : b.runRisk > 0.3 ? 'warn' : 'up'}">RUN RISK ${pct(b.runRisk, 0)}</span>
        ${meter(b.runRisk, b.runRisk > 0.6 ? 'r' : b.runRisk > 0.3 ? 'a' : 'g')}
        <p class="opnote">${b.depositors.toFixed(0)} depositors · reserve ratio ${pct(b.reserve / Math.max(1, b.deposits), 1)}</p></div></div>
    </div>
    <div class="card"><h3>LOAN BOOK</h3><table><tr><th>Borrower</th><th>Principal</th><th>Rate</th><th>Risk</th></tr>
      ${b.loanBook.slice(-8).reverse().map((l) => `<tr><td>${esc(l.borrower)}</td><td class="mono">${fmt(l.principal)}</td><td class="mono">${pct(l.rate, 0)}</td><td class="risk ${l.risk > 0.6 ? 'down' : 'dim'}">${pct(l.risk, 0)}</td></tr>`).join('') || '<tr><td colspan="4" class="dim">No active loans. Set sharper policy.</td></tr>'}
    </table></div>
  </div>` : b && b.failed ? `
  <div class="card selgrad"><h3 class="down">🏦 BANKRUPT</h3><p class="dim">Your bank collapsed. The Government opened a bailout docket to bury the crater.</p>
  <button class="btn gold" data-act="foundBank" style="margin-top:12px">Re-charter (${fmt(ct.BANK_FOUND_COST)})</button></div>` : `
  <div class="card"><h3>CHARTER A BANK</h3>
    <div class="row"><input id="bankName" placeholder="bank name (optional)" style="flex:1" />
      <button class="btn gold" data-act="foundBank">Charter — ${fmt(ct.BANK_FOUND_COST)}</button></div>
    <p class="opnote" style="margin-top:10px">You inherit a depositor base of locals. Set rates to attract their friends, lend at your chosen risk level. Fail on reserves and the run eats you.</p>
  </div>`);
}

// ---- media ----
function vMedia(s) {
  const M = P(s).media;
  if (!M) return head('MEDIA EMPIRE', 'Own the narrative.') + `
    <div class="card"><h3>FOUND A NETWORK</h3>
      <div class="row"><input id="netName" placeholder="network name (optional)" style="flex:1" />
        <button class="btn gold" data-act="foundNet">Launch — ${fmt(md.NETWORK_COST)}</button></div>
      <p class="opnote" style="margin-top:10px">Broadcasting earns reach → ad revenue, sentiment control, and dark ops: propaganda and slander at industrial scale.</p></div>`;
  const types = [['shill', '🚀 Shillcast $' + md.SHOW_COST.shill], ['talk', '🎙️ Talk ' + fmt(md.SHOW_COST.talk)], ['drama', '🎬 Drama ' + fmt(md.SHOW_COST.drama)], ['news', '📰 News ' + fmt(md.SHOW_COST.news)]];
  return head('MEDIA EMPIRE', `${esc(M.name)} — reach ${(M.reach * 100).toFixed(0)}% · FCC heat ${M.fccHeat.toFixed(1)}`) + `
  <div class="grid g2">
    <div class="card"><h3>PROGRAMMING GRID <span class="rt">episodes: ${M.episodes}</span></h3>
      ${M.shows.length ? M.shows.map((sh) => `
      <div class="row" style="border-bottom:1px dotted var(--line);padding-bottom:8px;margin-bottom:8px">
        <div style="flex:1"><b class="mono" style="color:var(--acc2)">${esc(sh.name)}</b><div class="dim" style="font-size:10px">${sh.type} · exposure ${'▮'.repeat(Math.round(clamp(sh.buzz / 3 * 10, 0, 10)))}</div></div>
        <button class="btn" data-act="air:${sh.id}">Air ep# ${sh.ep + 1}</button></div>`).join('') : '<p class="dim">No shows. Greenlight below.</p>'}
      <div class="row" style="margin-top:12px">${types.map(([t, l]) => `<button class="chip" data-act="show:${t}">${l}</button>`).join('')}</div>
    </div>
    <div class="card"><h3>DARK OPS — NARRATIVE WARFARE</h3>
      <div class="row"><select id="smTarget" style="flex:1">${s.corps.filter((c) => c.alive).map((c) => `<option>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="row">
        <button class="btn" data-act="smear:real">📰 Investigative exposé ($500K)</button>
        <button class="btn danger" data-act="smear:fake">🎭 Fake-news campaign ($500K)</button>
      </div>
      <p class="opnote">Exposés shrink targets for real with less blowback. Fabrications hit twice as hard — and the FCC is watching, especially after the Truth-in-Broadcast Act.</p>
      <div class="row" style="margin-top:10px"><span class="dim">gag factor: ${(s.gov.mediaGag || 0) ? 'MEDIA LAW ACTIVE — ops weakened 50%' : 'no broadcast restrictions'}</span></div>
    </div>
  </div>`;
}

// ---- underworld ----
function vCrime(s) {
  const p = P(s);
  return head('UNDERWORLD', 'Dirty money is money too — until it moves. Launder, hack, smuggle, bribe.') + `
  <div class="grid g2">
    <div class="card selgrad"><h3>DIRTY LEDGER <span class="rt">${fmt(P(s).dirty, true)}</span></h3>
      <div class="row"><input id="lau" type="number" min="0" placeholder="amount" style="width:150px" />
        <button class="chip" data-act="chip:lau:1">MAX</button>
        <button class="btn" data-act="launder">🧼 Launder (fee starts at 12%)</button></div>
      <p class="opnote">Bust chance scales with heat and size. Fee scales with heat too. Cool off with bribes on the right.</p>
      ${p.dirty * 0 + 1 ? `<div class="row" style="margin-top:8px"><button class="btn danger" data-act="smuggle">📦 Run a smuggling lane (up to 4× yield)</button></div>` : ''}
    </div>
    <div class="card"><h3>MERC CREWS — ${p.hackers || 0}</h3>
      <button class="btn gold" data-act="hire">Retain crew — ${fmt(350000)}</button>
      <div class="row" style="margin-top:12px"><select id="htTarget" style="flex:1">${s.corps.filter((c) => c.alive).map((c) => `<option>${esc(c.name)}</option>`).join('')}</select>
        <button class="btn danger" data-act="heist">🔐 Corporate heist</button></div>
      <p class="opnote">Loot lands 30% clean / 70% dirty. Bots also try to hack YOUR stack — racks & fiber are your shields.</p>
    </div>
    <div class="card"><h3>SPECIAL RELATIONSHIPS</h3>
      <div class="row"><input id="bri" type="number" placeholder="bribe $ (min 50K)" style="flex:1" />
        <button class="btn gold" data-act="bribe">🤝 Pay consultants</button></div>
      <p class="opnote">Cuts heat hard. Occasionally the "official" is wearing a wire — then you own two problems.</p>
      <div class="row" style="margin-top:10px"><span class="pill">senatorial pockets tapped: ${s.stats.bribes}</span>
      <span class="pill">ops laundered: ${fmt(s.stats.laundered)}</span>
      <span class="pill">heists won: ${s.stats.hackerWins}</span></div>
    </div>
  </div>`;
}

// ---- gov ----
function vGov(s) {
  const law = s.gov.pending;
  return head('GOVERNMENT & REGULATORS', 'The Senate trades in leverage. So do you.') + `
  <div class="grid g2">
    <div class="card"><h3>STATE OF THE STATE</h3>
      <div class="row"><span class="pill y">Transaction tax ${(s.gov.tax * 100).toFixed(0)}%</span>
        <span class="pill ${s.gov.warrants ? 'r' : 'g'}">Active warrants: ${s.gov.warrants}</span>
        <span class="pill">Bailouts paid: ${s.gov.bailouts}</span>
        ${s.gov.privacy ? '<span class="pill v">Privacy Deregulation active</span>' : ''}</div>
      <p class="opnote" style="margin-top:10px">${s.gov.law ? `Current regime: <b>${esc(s.gov.law.name)}</b> — ${esc(s.gov.law.desc)}` : 'No landmark law on the books yet.'}</p>
    </div>
    <div class="card ${law ? 'selgrad' : ''}"><h3>SENATE DOCKET${law ? '' : ' — RECESS'}</h3>
      ${law ? `
      <p><b class="mono" style="color:var(--acc)">${esc(law.name)}</b></p><p class="dim" style="font-size:12px;margin:4px 0 10px">${esc(law.desc)}</p>
      <span class="risk">SUPPORT ${(law.support * 100).toFixed(0)}%</span>${meter(law.support, law.support > 0.5 ? 'r' : 'g')}
      <div class="row" style="margin-top:12px"><input id="lob" type="number" placeholder="lobby $ (min 10K)" style="width:150px" />
        <button class="btn gold" data-act="lobby">💼 Lobby against</button></div>
      <p class="opnote">Lobbying shifts senators against the docket (mostly). Small chance of a sting.</p>` :
        '<p class="dim">The Senate is drafting in committees. Docket opens soon — heat your checkbooks.</p>'}
    </div>
  </div>`;
}

// ---- wire ----
function vWire(s) {
  const f = s.ui.wf || 'all';
  const posts = s.wire.filter((w) => f === 'all' || w.kind === f);
  return head('THE WIRE', 'The whole server reacts in real time — NPCs, scandals, pumps.') + `
    <div class="row">${['all', 'market', 'scandal', 'info'].map((k) => `<button class="chip ${f === k ? 'on' : ''}" style="${f === k ? 'border-color:var(--acc);color:var(--acc)' : ''}" data-act="wf:${k}">${k.toUpperCase()}</button>`).join('')}</div>
    <div class="card" style="margin-top:12px"><div class="feed">
      ${posts.slice(-80).reverse().map(wirePost).join('') || '<p class="dim">Silence on the wire… suspicious.</p>'}
    </div></div>`;
}

// ---- god terminal ----
function vGod(s) {
  const hist = (s.ui && s.ui.term) || [];
  return head('GOD PROTOCOL', `Server Admin: ${esc(s.email)} — full manual override engaged.`) + `
  <div class="term"><div class="out" id="termOut" tabindex="-1">${hist.map((x) => `<div class="cmdline">&gt; ${esc(x.c)}</div><div>${esc(x.out)}</div>`).join('')}</div>
    <form id="termForm"><input id="termIn" placeholder="help — list admin commands" autocomplete="off"/><button class="btn c">EXEC</button></form>
  </div>`;
}

// hashrate mini formatter
function md9(x) { return x >= 1000 ? (x / 1000).toFixed(2) + 'K' : x.toFixed(1); }
