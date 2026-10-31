/* OMNILIFE main: boot, login, the sim heartbeat, save loop, action delegation. */

import { el, toast, esc, num } from './util.js';
import { defaultState, loadState, saveState, wipeState, P, GOD_EMAIL } from './state.js';
import * as mk from './market.js';
import * as ct from './city.js';
import * as md from './media.js';
import * as w from './world.js';
import * as np from './npcs.js';
import * as ac from './actions.js';
import { renderTop, renderNav, renderPanel, PANELS } from './ui.js';
import { runGod } from './god.js';

let S = null;    // active state
let step = 0;    // speed accumulator

// ---------------- boot ----------------
const saved = loadState();
if (saved) attachResume();

function attachResume() {
  const btn = document.createElement('button');
  btn.className = 'big';
  btn.type = 'button';
  btn.textContent = '↩ RESUME LAST TYCOON';
  btn.style.background = 'linear-gradient(90deg,#c084fc,#e879f9)';
  btn.style.marginTop = '8px';
  btn.onclick = () => {
    S = loadState();
    boot();
  };
  document.getElementById('loginForm').appendChild(btn);
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('inName').value.trim() || 'Anonymous Tycoon';
  const email = el('inEmail').value.trim().toLowerCase();
  const god = email === GOD_EMAIL;
  S = defaultState({ name, email: email || 'tycoon@sector7.net', god });
  seedWire();
  if (god) toast('🔥 GOD PROTOCOL ENGAGED — admin terminal unlocked in navigation.', 'warn');
  boot();
});

// live hint while typing the god-key email
el('inEmail').addEventListener('input', (e) => {
  el('godHint').classList.toggle('show', e.target.value.trim().toLowerCase() === GOD_EMAIL);
});

function seedWire() {
  mk.wire(S, '🔔 SECTOR-7 MARKETS OPEN. Backbones hot, gas at $' + S.market.gasFee + '.', 'info');
  mk.wire(S, `${S.npcs[0].emoji} ${S.npcs[0].name} is reportedly raising a war chest.`, 'info');
  mk.wire(S, `📰 Wire editors confirm: every syndicate in the city is recruiting. Including yours.`, 'info');
}

function boot() {
  document.getElementById('login').style.display = 'none';
  el('app').classList.add('on');
  if (!S.ui) S.ui = { panel: 'dash', wf: 'all', term: [] };
  if (!S.uiSel) S.uiSel = {};
  renderAll();
  // heartbeat: 4 steps per second, speed multiplies ticks
  setInterval(() => {
    if (!S || S.speed === 0) return;
    step += S.speed;
    while (step >= 4) { step -= 4; tick(); }
  }, 250);
}

function renderAll() {
  if (!S.ui) S.ui = { panel: 'dash', wf: 'all', term: [] };
  if (!S.uiSel) S.uiSel = {};
  renderTop(S);
  renderNav(S);
  renderPanel(S);
}

// ---------------- the sim tick ----------------
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
  // passive rent trickle
  P(s).cash += ct.rentIncome(s) * 0.02;
  // log lines with in-world stamp
  for (const line of out) {
    if (!line) continue;
    const day = Math.floor(s.tick / 48) + 1;
    s.log.push({ t: 'd' + day, text: line });
    if (s.log.length > 120) s.log.shift();
  }
  // autosave & repaint
  if (s.tick % 8 === 0) saveState(s);
  renderTop(s);
  renderNav(s);
  renderPanel(s);
}

// toast relay: show newest log line occasionally

// ---------------- action delegation ----------------
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !b.isConnected) return;
  const [act, a1, a2, a3] = b.dataset.act.split(':');
  const s = S;
  if (!s) return;
  // ignore clicks inside the god terminal form (handled separately)
  if (b.closest && b.closest('#termForm')) return;
  const done = (r) => { if (r) toast(r.msg || (r.ok ? 'Done.' : 'Blocked.'), r.ok ? 'ok' : 'bad'); renderAll(); };
  const val = (id) => (el(id) ? el(id).value : '');
  const p = P(s);

  switch (act) {
    case 'go': s.ui.panel = a1; renderAll(); break;
    case 'speed': s.speed = +a1; renderTop(s); break;
    case 'newgame': {
      if (confirm('Erase this tycoon and reboot Sector-7?')) { wipeState(); location.reload(); }
      break;
    }
    case 'chip': { // set money input to fraction of clean cash
      const inp = el(a1); if (inp) inp.value = Math.max(0, Math.floor(p.cash * num(a2))).toString();
      break;
    }
    case 'chipu': { // set token input to fraction of holdings
      const inp = el(a1); if (inp) inp.value = (Math.floor((p.tok[a2] || 0) * num(a3) * 1e6) / 1e6).toString();
      break;
    }
    // ----- trade -----
    case 'buy': done(mk.buyToken(s, a1, num(val('amtBuy')))); break;
    case 'sell': done(mk.sellToken(s, a1, num(val('amtSell')))); break;
    case 'sel': s.uiSel.sym = a1; renderAll(); break;
    case 'shbuy': done(mk.buyStock(s, a1, num(val('sh_' + a1)))); break;
    case 'shsell': done(mk.sellStock(s, a1, 1)); break;
    case 'foundCorp': done(mk.foundCorp(s, val('corpName').trim())); break;
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
    case 'wf': s.ui.wf = a1; renderAll(); break;
    default: break;
  }
});

// ---------------- god terminal wiring ----------------
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'termForm' || !S) return;
  e.preventDefault();
  const term = el('termOut');
  const inputText = el('termIn').value;
  el('termIn').value = '';
  const r = runGod(S, inputText);
  S.ui.term = S.ui.term || [];
  S.ui.term.push({ c: inputText, out: r.out });
  if (S.ui.term.length > 120) S.ui.term.splice(0, S.ui.term.length - 120);
  if (r.action === 'wipe') {
    if (confirm('God wipe: erase the simulation state and reboot?')) { wipeState(); location.reload(); }
    return;
  }
  if (term) term.innerHTML = (S.ui.term || []).map((x) => `<div class="cmdline">&gt; ${esc(x.c)}</div><div>${esc(x.out)}</div>`).join('');
  term && (term.scrollTop = term.scrollHeight);
  renderTop(S);
});
