/* OMNILIFE World Engine: autonomous macroeconomic events driven by live server
 * state, the Government & Senate (taxes, laws, bailouts), and police warrants.
 * This module is the Dungeon-Master layer of the world. */

import { rng, rand, pick, clamp, num, fmt } from './util.js';
import { P, price, LAW_POOL } from './state.js';
import { wire } from './market.js';

/** weight-based event scheduler; returns array of log lines */
export function tickWorld(s) {
  const out = [];
  // heat decays slowly; more slowly in a high-congestion surveillance state
  const decay = s.city.congestion > 1 ? 0.08 : 0.18;
  P(s).heat = clamp(P(s).heat - decay * 0.2 + (P(s).dirty > 5e6 ? 0.15 : 0), 0, 100);

  // ---- macro event cadence: roughly every 40-90 ticks spawn a big event ----
  if (s.tick - (s.gov.lastEvent || 0) > rand(38, 82)) {
    s.gov.lastEvent = s.tick;
    const ev = pickEvent(s);
    if (ev) out.push(...applyEvent(s, ev));
  }

  // ---- law cycle ----
  s.gov.lawIn -= 1;
  if (!s.gov.pending && s.gov.lawIn <= 0) {
    const law = pick(LAW_POOL.filter((l) => l.id !== s.gov.law?.id));
    s.gov.pending = { ...law, support: rand(0.3, 0.7) };
    out.push(`🗳️ SENATE DOCKET: "${law.name}" is being debated. ${law.desc}.`);
    s.gov.lawIn = rand(90, 160);
  }
  if (s.gov.pending) {
    // senators drift; bribes add support
    s.gov.pending.support = clamp(s.gov.pending.support + rand(-0.002, 0.044) + (s.gov.lobbyScore || 0) * 0.001, 0.02, 0.98);
    if (s.forcedVote) {
      s.forcedVote = false;
      out.push(...voteLaw(s, s.gov.pending.support > 0.5));
    } else if (rng() < 0.012) { // eventually voted
      out.push(...voteLaw(s, s.gov.pending.support > 0.5));
    }
  }

  // ---- warrants: police finally act when heat is boiling ----
  if (P(s).heat > 78 && s.gov.warrants >= 1 && rng() < 0.01) {
    out.push(...enforceWarrant(s));
  }
  return out;
}

function pickEvent(s) {
  const pool = [];
  const m = s.market.sentiment;
  if (m.crypto < 0.35) pool.push('crash', 'crackdown');
  if (m.crypto > 0.65) pool.push('aiBoom', 'pump');
  if (s.city.congestion > 1.2) pool.push('supplyChain');
  if (P(s).bank && P(s).bank.deposits > 2e7) pool.push('bankAudit');
  if (s.player.media) pool.push('cultureWar');
  pool.push('supplyChain', 'regulation', 'whaleDrama', 'datacenterBoom', 'blackout');
  pool.push('supplyChain', 'regulation', 'whaleDrama', 'datacenterBoom', 'blackout');
  return pick(pool);
}

function applyEvent(s, ev) {
  const out = [];
  switch (ev) {
    case 'crash': {
      const sym = pick(s.tokens.filter((t) => t.sym !== 'WUSD')).sym;
      const t = s.tokens.find((x) => x.sym === sym);
      t._whale = -0.5;
      s.market.sentiment.crypto = clamp(s.market.sentiment.crypto - 0.25, 0.05, 0.95);
      out.push(`🩸 BLACK SWAN: institutional panic depegs ${sym} — DEX liquidity evaporates.`);
      break;
    }
    case 'pump': {
      const t = pick(s.tokens.filter((x) => x.sym !== 'WUSD'));
      t._whale = 0.55;
      s.market.sentiment.crypto = clamp(s.market.sentiment.crypto + 0.2, 0.05, 0.95);
      out.push(`🚀 DISTRICT RUMOR: sovereign-fund whispers pump ${t.sym} across the city.`);
      break;
    }
    case 'aiBoom': {
      s.market.sentiment.media = clamp(s.market.sentiment.media + 0.15, 0.05, 0.95);
      const c = s.corps.find((x) => x.sector === 'AI Compute');
      if (c) { c.price *= rand(1.25, 1.6); }
      out.push('🧠 AI TECH BOOM: compute demand detonates; Neuras moons while bond desks sweat.');
      break;
    }
    case 'supplyChain':
      s.market.sentiment.crypto = clamp(s.market.sentiment.crypto - 0.1, 0.05, 0.95);
      for (const d of s.city.districts) if (d.id === 'ind' || d.id === 'port') d.sentiment = clamp(d.sentiment - 0.25, 0.05, 0.95);
      out.push('🚢 GLOBAL SUPPLY CHAIN COLLAPSE: the Rustworks and Old Harbor choke. Mining rigs idle.');
      break;
    case 'regulation': {
      s.gov.tax = clamp(s.gov.tax + rand(0.02, 0.05), 0.05, 0.45);
      s.market.gasFee = Math.round(s.market.gasFee * 1.3);
      out.push(`🏛️ REGULATORY CRACKDOWN: transaction tax raised to ${(s.gov.tax * 100).toFixed(0)}%. Gas spikes.`);
      break;
    }
    case 'bankAudit': {
      const b = P(s).bank;
      if (!b) break;
      out.push(`🕵️ CENTRAL BANK AUDIT: your reserves (${(b.reserve / b.deposits * 100 || 0).toFixed(0)}% of deposits) are being inspected.`);
      if (b.reserve / Math.max(1, b.deposits) < 0.2) {
        b.runRisk = clamp(b.runRisk + 0.3, 0, 0.95);
        out.push('📉 The audit found you thin. Run risk climbing.');
      }
      break;
    }
    case 'cultureWar': {
      s.market.sentiment.media = clamp(s.market.sentiment.media + rand(-0.3, 0.3), 0.05, 0.95);
      out.push('📺 CULTURE WAR WEEK: every network is screaming. Ad rates (and smears) are profitable.');
      break;
    }
    case 'datacenterBoom':
      out.push('⚡ DATACENTER BOOM: fiber in your districts is worth more this week.');
      for (const d of s.city.districts) if (d.fiber) d.idx = clamp(d.idx * 1.08, 0.15, 6);
      break;
    case 'blackout': {
      s.city.congestion = clamp(s.city.congestion + 0.7, 0.05, 2);
      out.push('🌃 CITY BLACKOUT: backbone congestion spikes, gas fees moon.');
      break;
    }
    case 'whaleDrama': {
      const n = pick(s.npcs);
      out.push(`${n.emoji} DESK GOSSIP: ${n.name} is quietly accumulating. Sources refuse to name the target.`);
      break;
    }
  }
  return out;
}

// ---------------- laws & senate ----------------
export function lobbyLaw(s, amount) {
  if (!s.gov.pending) return { ok: false, msg: 'No active docket.' };
  amount = num(amount);
  if (amount < 10000) return { ok: false, msg: 'Minimum $10K to smell a senator.' };
  if (amount > P(s).cash) return { ok: false, msg: 'Insufficient clean cash.' };
  P(s).cash -= amount;
  P(s).heat = clamp(P(s).heat + 6, 0, 100);
  s.stats.bribes += 1;
  const eff = amount / Math.max(1e6, P(s).cash + amount) * 0.35;
  if (rng() < 0.12) {
    // leaked wiretaps — Feds are watching the money
    P(s).heat = clamp(P(s).heat + 22, 0, 100);
    s.gov.catsillos = true; // narrative hook: a leak case open against you
    return { ok: false, msg: '🚨 STING! Your "lobbyist" was wearing a wire. Heat +22.' };
  }
  s.gov.pending.support = clamp(s.gov.pending.support - eff * (1 - (s.gov.lobbyScore || 0.3)), 0.02, 0.98);
  s.gov.lobbyScore = clamp((s.gov.lobbyScore || 0.3) + 0.02, 0, 1);
  return {
    ok: true,
    msg: `💼 Lobbied "${s.gov.pending.name}" with ${fmt(amount)} (opposing, support ${(s.gov.pending.support * 100).toFixed(0)}% → spun).`,
  };
}

export function voteLaw(s, passed) {
  const out = [];
  const law = s.gov.pending;
  s.gov.pending = null;
  s.gov.law = law;
  s.gov.lobbyScore = 0.3;
  if (!passed) { out.push(`❌ FAILED: ${(law.support * 100).toFixed(0)}% of the Senate rejected "${law.name}".`); return out; }
  out.push(`✅ SIGNED INTO LAW: "${law.name}". ${law.desc}`);
  switch (law.id) {
    case 'crypto': s.gov.tax = clamp(s.gov.tax + 0.02, 0.05, 0.5); break;
    case 'bank': if (P(s).bank) P(s).bank.runRisk = clamp(P(s).bank.runRisk - 0.1, 0, 1); break;
    case 'media': s.gov.mediaGag = 0.5; break;
    case 'tax': {
      const rich = s.npcs.filter((n) => n.money > 2e9);
      for (const n of rich) n.money *= 0.9;
      P(s).cash *= 0.95;
      out.push('💸 Sent wealth-harvesting drones out. Your 5% was grabbed "for public services".');
      break;
    }
    case 'privacy': s.gov.privacy = true; break;
    case 'gamble': {
      const g = s.city.districts.find((d) => d.id === 'gas');
      g.idx = clamp(g.idx * 1.25, 0.15, 6);
      break;
    }
  }
  return out;
}

// ---------------- warrants & enforcement ----------------
export function enforceWarrant(s) {
  const out = [];
  const heat = P(s).heat;
  const stakes = Math.max(2e4, Math.min(P(s).cash, P(s).cash * (heat - 70) / 30));
  if (rng() < 0.5 + P(s).rep / 200) {
    P(s).cash -= stakes;
    P(s).heat = clamp(heat - 40, 0, 100);
    s.gov.warrants = Math.max(0, s.gov.warrants - 1);
    out.push(`⚖️ EXECUTED WARRANT: assets seized (${fmt(stakes)}) paid as a settlement. Heat cools.`);
  } else {
    P(s).heat = clamp(heat - 10, 0, 100);
    s.gov.warrants = Math.max(0, s.gov.warrants - 1);
    out.push('⚖️ Your lawyers gutted the warrant in court. The papers never ran the story.');
  }
  return out;
}
