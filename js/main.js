/* OMNILIFE main v2: boot, login, sim heartbeat (incremental DOM updates),
 * autosave, action delegation (all legacy data-act actions preserved +
 * new sheet/drawer/wizard/preview actions). Engine modules untouched. */

import { el, toast, esc, num, UC, savePos, addFlow, clearNotis } from './util.js';
import { defaultState, loadState, saveState, wipeState, P, GOD_EMAIL } from './state.js';
import * as mk from './market.js';
import * as ct from './city.js';
import * as md from './media.js';
import * as w from './world.js';
import * as np from './npcs.js';
import * as ac from './actions.js';
import * as ui from './ui.js';
import { runGod } from './god.js';

let S = null;   // active state
let step = 0;   // speed accumulator
let prevCash = 0;

// ---------------- boot ----------------
const saved = loadState();
if (saved) attachResume();

function attachResume() {
  const btn = document.createElement('button');
  btn.className = 'big';
  btn.type = 'button';
  btn.textContent = '↩ RESUME LAST TYCOON';
  btn.onclick = () => {
    const ov = el('boot');
    if (ov) ov.classList.add('on');
    S = loadState();
    setTimeout(() => { normalise(S); boot(); }, 260); // deliberate loading beat
  };
  document.getElementById('loginForm').appendChild(btn);
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const ov = el('boot');
  if (ov) ov.classList.add('on');
  const name = el('inName').value.trim() || 'Anonymous Tycoon';
  const email = el('inEmail').value.trim().toLowerCase();
  const god = email === GOD_EMAIL;
  S = defaultState({ name, email: email || 'tycoon@sector7.net', god });
  seedWire();
  setTimeout(() => boot(), 300);
});

// live hint while typing the god-key email
el('inEmail').addEventListener('input', (e) => {
  el('godHint').classList.toggle('show', e.target.value.trim().toLowerCase() === GOD_EMAIL);
});

function seedWire() {
  mk.wire(S, '🔔 SECTOR-7 MARKETS OPEN. Backbones hot, gas at $' + S.market.gasFee + '.', 'info');
  mk.wire(S, `${S.npcs[0].emoji} ${S.npcs[0].name} is reportedly raising a war chest.`, 'info');
  mk.wire(S, '📰 Wire editors confirm: every syndicate in the city is recruiting. Including yours.', 'info');
}

/** normalise runtime UI scaffolding on a (possibly old) save */
function normalise(s) {
  if (!s.ui) s.ui = { panel: 'dash', wf: 'all', sub: 'tok', term: [] };
  if (!s.uiSel) s.uiSel = { sym: s.tokens[0]?.sym };
  if (s.uiSel && !s.uiSel.sym) s.uiSel.sym = s.tokens[0]?.sym;
  ui.setS(s);
}

function boot() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('boot').classList.remove('on');
  document.getElementById('app').classList.add('on');
  normalise(S);
  ui.init();
  prevCash = P(S).cash;
  ui.renderAll(S);
  toast(`Welcome to Sector-7, ${S.name}. The sim is live.`, 'ok');
  if (S.god) toast('🔥 GOD PROTOCOL ENGAGED — admin terminal unlocked in navigation.', 'warn');
  setInterval(() => {
    if (!S || S.speed === 0) return;
    step += S.speed;
    while (step >= 4) { step -= 4; tick(); }
  }, 250);
}

// ---------------- the sim tick (incremental DOM only) ----------------
function tick() {
  const s = S;
  s.tick += 1;
  const out = [];
  out.push(...ct.tickMining(s, []));
  mk.tickTokens(s);
  mk.tickStocks(s);
  ct.tickCity(s);
  out.push(...ct.tickBank(s, []));
  out.push(...w.tickWorld(s));
  np.tickNpcs(s);
  out.push(...md.tickMedia(s));
  P(s).cash += ct.rentIncome(s) * 0.02;
  // cash flow ledger for the dashboard (clean-cash delta)
  const delta = P(s).cash - prevCash;
  addFlow(s, delta);
  prevCash = P(s).cash;

  for (const line of out) {
    if (!line) continue;
    s.log.push({ t: 'd' + (Math.floor(s.tick / 48) + 1), text: line });
    if (s.log.length > 120) s.log.shift();
    if (line.startsWith('🚨') || line.startsWith('💀') || line.startsWith('⚖️')) toast(line, 'bad');
  }
  if (s.tick % 8 === 0) saveState(s);
  ui.tickPage(s);   // updates live nodes + topbar (diffed), no full rewrite
  ui.renderNav(s);  // diffed; rebuilds only on change
}

// ---------------- basis (P/L) recording for trades ----------------
function recTok(s, sym, { qty = 0, cost = 0 } = {}) {
  const rec = UC.pos[sym] || { q: 0, c: 0 };
  rec.q = Math.max(0, rec.q + qty);
  rec.c = Math.max(0, rec.c + cost);
  if (rec.q < 1e-9 || rec.c < 1e-9) delete UC.pos[sym];
  else UC.pos[sym] = rec;
  savePos();
}
function recStock(cid, { qty = 0, cost = 0 } = {}) {
  const key = 'S:' + cid;
  const rec = UC.pos[key] || { q: 0, c: 0 };
  rec.q = Math.max(0, rec.q + qty);
  rec.c = Math.max(0, rec.c + cost);
  if (rec.q < 1e-9 || rec.c < 1e-9) delete UC.pos[key];
  else UC.pos[key] = rec;
  savePos();
}

// ---------------- action delegation ----------------
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !b.isConnected) return;
  if (b.closest && b.closest('#termForm')) return;
  const [act, a1, a2, a3] = b.dataset.act.split(':');
  const s = S;
  if (!s) return;
  const done = (r) => { if (r) toast(r.msg || (r.ok ? 'Done.' : 'Blocked.'), r.ok ? 'ok' : 'bad'); ui.renderAll(s); };
  const val = (id) => (el(id) ? el(id).value : '');
  const p = P(s);

  switch (act) {
    case 'go': {
      s.ui.panel = a1;
      ui.closeSheet();
      s.ui.sub = s.ui.sub || 'tok';
      ui.renderAll(s);
      break;
    }
    case 'speed': s.speed = +a1; ui.renderTop(s); break;
    case 'newgame': if (confirm('Erase this tycoon and reboot Sector-7?')) { wipeState(); location.reload(); } break;
    case 'sub': s.ui.sub = a1; ui.renderAll(s); break;

    // ----- global overlays -----
    case 'more': ui.moreSheet(s); break;
    // scrim click closes only when the tap was on the backing layer itself,
    // never from bubbled clicks inside the sheet body/title
    case 'sheet': if (a1 === 'close' && e.target === b) { if (ui.wizActive()) ui.wizClose(); else ui.closeSheet(); } break;
    case 'noti': ui.toggleDrawer(); break;
    case 'drawer': if (a1 === 'close') ui.closeDrawer(); break;
    case 'noti' : if (a1 === 'clear') { clearNotis(); ui.renderDrawer(s); } break;

    // ----- quick amount chips (money fraction of clean cash) -----
    // targeted update only: keeps the typed input focused & alive
    case 'chip': { const inp = el(a1); if (inp) inp.value = Math.max(0, Math.floor(p.cash * num(a2))).toString(); ui.tickPage(s); break; }
    case 'chipu': { const inp = el(a1); if (inp) inp.value = (Math.floor((p.tok[a2] || 0) * num(a3) * 1e6) / 1e6).toString(); ui.tickPage(s); break; }

    // ----- trade -----
    case 'buy': {
      const sym = a1, amt = num(val('opBuy'));
      const q0 = p.tok[sym] || 0, c0 = p.cash;
      const r = mk.buyToken(s, sym, amt);
      if (r.ok) recTok(s, sym, { qty: (p.tok[sym] || 0) - q0, cost: c0 - p.cash });
      done(r); break;
    }
    case 'sell': {
      const sym = a1, qts = num(val('opSell'));
      const q0 = p.tok[sym] || 0, rec = UC.pos[sym];
      const r = mk.sellToken(s, sym, qts);
      if (r.ok && rec) recTok(s, sym, { qty: (p.tok[sym] || 0) - q0, cost: -rec.c * (qts / Math.max(1e-9, q0)) });
      done(r); break;
    }
    case 'sel': s.uiSel.sym = a1; ui.renderAll(s); break;
    case 'shbuy': {
      const qty = Math.floor(num(val('sh_' + a1)));
      const q0 = p.shares[a1] || 0, c0 = p.cash;
      const r = mk.buyStock(s, a1, qty);
      if (r.ok) recStock(a1, { qty: (p.shares[a1] || 0) - q0, cost: c0 - p.cash });
      done(r); break;
    }
    case 'shsell': {
      const q0 = p.shares[a1] || 0, rec = UC.pos['S:' + a1];
      const r = mk.sellStock(s, a1, 1);
      if (r.ok && rec) recStock(a1, { qty: (p.shares[a1] || 0) - q0, cost: -rec.c });
      done(r); break;
    }
    case 'foundCorpDirect': done(mk.foundCorp(s, val('corpName').trim())); break;

    // ----- lab -----
    case 'mint': done(mk.mintToken(s, { sym: val('mSym'), name: val('mName'), supply: num(val('mSupply'), 1e8), liquidity: num(val('mLiq'), 2.5e5) })); break;
    case 'addLp': done(mk.addLiquidity(s, a1, num(val('lp_' + a1)))); break;
    case 'rmLp': done(mk.removeLiquidity(s, a1, 1)); break;
    case 'stakeIt': done(mk.stake(s, a1, p.tok[a1] || 0)); break;
    case 'unStake': done(mk.unstake(s, a1, 1)); break;
    case 'flash': done(mk.flashLoan(s, (el('flTarget') || {}).value || 'CHAD')); break;
    case 'rug': done(mk.rugPull(s, (el('rugTarget') || {}).value || '')); break;

    // ----- city -----
    case 'rack': done(ct.buyRack(s)); break;
    case 'mine': done(ac.toggleMining(s)); break;
    case 'prop': done(ct.buyProperty(s, a1)); break;
    case 'fiber': done(ct.layFiber(s, a1)); break;

    // ----- bank -----
    case 'foundBank': done(ct.foundBank(s, val('bankName').trim())); break;
    case 'rateSet': done(ct.setRate(s, num(val('rate')))); break;
    case 'policy': done(ct.setPolicy(s, a1)); break;
    case 'recap': done(ct.recap(s, num(val('rcam')))); break;

    // ----- media -----
    case 'foundNet': done(md.foundNetwork(s, val('netName').trim())); break;
    case 'show': done(md.greenlightShow(s, a1, '')); break;
    case 'airx': break;
    case 'air-listed': break;
    case 'aired': break;
    case 'air:': break;
    case 'air-old': break;
    case 'air2': break;
    case 'air': done(md.airShow(s, a1)); break;
    case 'smear': done(md.smearCampaign(s, val('smTarget') || '', a1 === 'fake')); break;

    // ----- crime -----
    case 'launder': done(ac.launder(s, num(val('lau')))); break;
    case 'hire': done(ac.hireHacker(s)); break;
    case 'heist': done(ac.corpHeist(s, (el('htTarget') || {}).value || '')); break;
    case 'smuggle': done(ac.smuggleRun(s)); break;
    case 'bribe': done(ac.bribeOfficial(s, num(val('bri')))); break;

    // ----- gov -----
    case 'lobby': done(w.lobbyLaw(s, num(val('lob')))); break;
    case 'wf': s.ui.wf = a1; ui.renderAll(s); break;

    // ----- wizards -----
    case 'wizOpen': ui.wizOpen(a1); break;
    case 'wizNext': ui.wizNext(); break;
    case 'wizBack': ui.wizBack(); break;
    case 'wizGo': ui.wizGo(s); break;
    case 'wizClose': ui.wizClose(); break;

    default: break;
  }
});

// ---------------- god terminal wiring ----------------
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'termForm' || !S) return;
  e.preventDefault();
  const term = el('termOut');
  const text = el('termIn').value;
  el('termIn').value = '';
  const r = runGod(S, text);
  S.ui.term = S.ui.term || [];
  S.ui.term.push({ c: text, out: r.out });
  if (S.ui.term.length > 120) S.ui.term.splice(0, S.ui.term.length - 120);
  if (r.action === 'wipe') {
    if (confirm('God wipe: erase the simulation state and reboot?')) { wipeState(); location.reload(); }
    return;
  }
  put_term(text, r);
});
function put_term(text, r) {
  const term = el('termOut');
  if (!term) return;
  const segs = (S.ui.term || []).map((x) => `<div class="cmdline">&gt; ${esc(x.c)}</div><div>${esc(x.out)}</div>`).join('');
  term.innerHTML = segs;
  term.scrollTop = term.scrollHeight;
}
