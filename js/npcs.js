/* OMNILIFE autonomous rival masterminds: every NPC is an active intelligence
 * running its own agenda — launching companies, pumping their bags, smearing
 * rivals, hacking your servers, bribing senators, hoarding property. The Wire
 * feeds off their decisions. */

import { rng, rand, pick, clamp, num, fmt, cfmt, pushCapped } from './util.js';
import { P, price } from './state.js';
import { wire, buyToken, sellToken, quote } from './market.js';

const MOODS = ['hoarding', 'aggressive', 'smearing', 'idle', 'lobbying', 'hunting'];

export function tickNpcs(s) {
  for (const n of s.npcs) {
    n.nextActIn -= 1;
    if (n.nextActIn <= 0) {
      n.nextActIn = rand(6, 20);
      act(n, s);
    }
    // NPC portfolios quietly mark-to-market: they own tokens with us
    driftPortfolio(s, n);
  }
}

function setMood(n, s) {
  const cryptoGold = s.market.sentiment.crypto > 0.6;
  if (n.archetype === 'Crypto Whale') n.mood = cryptoGold ? 'aggressive' : pick(['hoarding', 'hunting', 'idle']);
  else if (n.archetype === 'Media Baroness') n.mood = pick(['smearing', 'lobbying', 'idle']);
  else if (n.archetype === 'Cartel Financier') n.mood = pick(['hoarding', 'hunting', 'idle']);
  else if (n.archetype === 'Reform Senator') n.mood = pick(['lobbying', 'idle', 'idle']);
  else if (n.archetype === 'Old Money') n.mood = pick(['hoarding', 'lobbying', 'idle']);
  else n.mood = pick(['hoarding', 'aggressive', 'idle']);
}

function act(n, s) {
  setMood(n, s);
  const t = n.traits;
  let moveRoll = rng();
  const greed = t.greed, agg = t.aggression;

  // 1) PUMP & DUMP cycle: accumulate then dump
  if (n.mood === 'aggressive' && moveRoll < 0.45) {
    const tok = pick(s.tokens.filter((x) => !x.rugPulled && x.sym !== 'WUSD'));
    if (!tok) return;
    const size = n.money * rand(0.01, 0.06);
    if (rng() < greed) {
      tok._whale = clamp(tok._whale + rand(0.02, 0.07), -0.2, 0.35);
      n.holdings[tok.sym] = (n.holdings[tok.sym] || 0) + size / Math.max(1e-9, price(tok));
      n.money -= size;
      // whale chatter surfaces on the wire
      if (rng() < 0.5) wire(s, `${n.emoji} ${n.name}: "Accumulating ${tok.sym}. Chart looks criminally undervalued." 🚀`, 'market');
    } else {
      // dump phase
      const sym = pick(Object.keys(n.holdings));
      const amt = n.holdings[sym];
      if (amt > 0) {
        const tt = s.tokens.find((x) => x.sym === sym);
        tt._whale = clamp(tt._whale - rand(0.05, 0.12), -0.3, 0.3);
        n.money += amt * price(tt) * 0.96;
        delete n.holdings[sym];
        wire(s, `${n.emoji} DESK WATCH: ${n.name} just dumped a mountain of ${sym}. Tape is bleeding.`, 'market');
      }
    }
    return;
  }

  // 2) MEDIA SMEAR: damage a corporation (often yours)
  if (n.mood === 'smearing' || moveRoll < 0.18) {
    const targets = s.corps.filter((c) => c.alive);
    const target = pick(targets);
    if (!target) return;
    const playerTarget = target.ceo === s.name;
    const power = n.archetype === 'Media Baroness' ? 1.6 : 1;
    target.price *= 1 - 0.04 * power * rand(0.6, 1.2);
    n.money -= rand(2e5, 2e6);
    wire(s, `${n.emoji} INVESTIGATION: "${target.name} cooked its books" alleges a ${n.archetype}-linked outlet. ${playerTarget ? 'THEY ARE AIMING AT YOU.' : ''}`, playerTarget ? 'scandal' : 'info');
    return;
  }

  // 3) HACK OPS against the player's ISP / datacenter
  if ((n.mood === 'hunting' || (agg > 0.6 && rng() < 0.25)) && s.player.racks > 0) {
    const defUp = (P(s).fiberTotal || 0) * 0.08 + s.player.racks * 0.03;
    if (rng() < 0.12 + agg * 0.2 - defUp) {
      const loot = Math.min(P(s).cash * rand(0.05, 0.2), 3e6);
      P(s).cash -= loot;
      s.player.outageTicks = 10;
      wire(s, `💀 CYBER-ATTACK: ${n.name}'s mercs breached your datacenter. Looted ${fmt(loot)} — you were offline 10 ticks.`, 'scandal');
    } else {
      wire(s, `🛡️ Your SOC repelled an intrusion attributed to ${n.name}. Their signature is burned!`, 'info');
      n.heat = clamp((n.heat || 0) + 20, 0, 100);
    }
    return;
  }

  // 4) BRIBE SENATE and steer a pending law
  if (n.mood === 'lobbying' && s.gov.pending && rng() < 0.5) {
    s.gov.pending.support = clamp(s.gov.pending.support + rand(-0.1, 0.14), 0.02, 0.98);
    n.money -= rand(5e5, 5e6);
    if (rng() < 0.3) wire(s, `${n.emoji} LOBBY WATCH: ${n.name} rented the penthouse suite the Senate caucus is "dining" at.`, 'info');
    return;
  }

  // 5) FOUND A RIVAL CORPORATION (IPO that lists against you)
  if (n.money > 6e8 && rng() < 0.08 + greed * 0.15) {
    const names = ['Helion Dynamics', 'Meridian Exchange', 'Kobol Freight', 'Aster Metals', 'Zenith Analytics', 'Umbra Security'];
    const nm = pick(names) + ' ' + pick(['Corp', 'Group', ' PLC', 'Inc']);
    if (s.corps.length < 14) {
      s.corps.push({
        id: 'c_npc_' + Math.floor(rng() * 1e9).toString(36),
        name: nm, sector: pick(['AI Compute', 'Media', 'Logistics', 'Defense', 'Retail', 'Extraction']),
        ceo: n.name, shares: rand(60, 200) * 1e6,
        price: rand(4, 28), drift: rand(0.0005, 0.0025), vol: rand(0.015, 0.03),
        hist: [10], alive: true,
      });
      n.money -= 1.5e8;
      wire(s, `🔔 IPO: ${n.name} rang the bell for ${nm}. Buy-side desks scramble.`, 'market');
    }
    return;
  }

  // 6) PROPERTY BUY-UPS
  if (rng() < 0.25) {
    const d = pick(s.city.districts);
    const cost = d.base * d.idx * 1.1;
    if (n.money > cost * 1.5) {
      n.money -= cost;
      d.idx = clamp(d.idx * 1.02, 0.15, 6);
      if (rng() < 0.25) wire(s, `${n.emoji} RECORD BOOKS: ${n.name} quietly bought up blocks of ${d.name}.`, 'info');
    }
    return;
  }

  // 7) LAUNDER: cartel & whale types keep dirty books clean via shell corps
  if (n.archetype === 'Cartel Financier' && rng() < 0.3) {
    const clean = n.money * rand(0.05, 0.15);
    n.money -= clean * 0.12; // laundering fee burned
    if (rng() < 0.2) wire(s, `🦈 FINANCIAL TIMES: An offshore web tied to ${n.name} moved $${(clean / 1e6).toFixed(1)}M unnoticed.`, 'info');
  }
}

function driftPortfolio(s, n) {
  for (const sym of Object.keys(n.holdings)) {
    const t = s.tokens.find((x) => x.sym === sym);
    if (!t || t.rugPulled) { delete n.holdings[sym]; continue; }
    // npc paper wealth follows live price (their displayed money already includes wiring)
  }
}
