/* OMNILIFE player actions: crime syndicate ops, laundering, bribes,
 * and everything the UI buttons call. Each returns {ok, msg}. */

import { rng, rand, clamp, num, fmt, pick } from './util.js';
import { P, price } from './state.js';
import { wire } from './market.js';

// ---------------- money laundering & underworld ----------------
export function launder(s, amount) {
  amount = num(amount);
  if (amount <= 0) return { ok: false, msg: 'Enter amount.' };
  if (amount > P(s).dirty) return { ok: false, msg: `Only ${fmt(P(s).dirty)} dirty cash.` };
  const fee = 0.12 + P(s).heat / 100 * 0.15;         // pricier when hot
  const clean = amount * (1 - fee);
  const bustChance = clamp(0.05 + P(s).heat / 260 + amount / Math.max(1, P(s).dirty * 3) * 0.1, 0.02, 0.6);
  P(s).dirty -= amount;
  if (rng() < bustChance * (s.gov.privacy ? 0.7 : 1)) {
    P(s).heat = clamp(P(s).heat + 18, 0, 100);
    s.gov.warrants += 1;
    return { ok: false, msg: `🚨 LAUNDERING HIT A TRAP: $${amount.toFixed(0)} confiscated, warrant issued!` };
  }
  P(s).cash += clean;
  s.stats.laundered += amount;
  P(s).heat = clamp(P(s).heat + 3, 0, 100);
  return { ok: true, msg: `🧼 Cleaned ${fmt(clean)} (fee ${(fee * 100).toFixed(0)}%). Shell corp commissions cleared.` };
}

export function hireHacker(s) {
  const cost = 350000;
  if (P(s).cash < cost) return { ok: false, msg: `Retainer is ${fmt(cost)}.` };
  P(s).cash -= cost;
  P(s).hackers = (P(s).hackers || 0) + 1;
  P(s).heat = clamp(P(s).heat + 4, 0, 100);
  return { ok: true, msg: `Hired a merc crew (${P(s).hackers} active). Ops scripts unlocked.` };
}

export function corpHeist(s, targetName) {
  if (!(P(s).hackers > 0)) return { ok: false, msg: 'Hire hackers first.' };
  const corp = s.corps.find((c) => c.name === targetName && c.alive);
  if (!corp) return { ok: false, msg: 'Target not found.' };
  const guard = (corp.ceo && corp.ceo.startsWith('Dr.')) ? 0.65 : 0.5;
  const guard2 = guard - (P(s).hackers * 0.06) - (s.gov.privacy ? 0.1 : 0);
  if (rng() < guard2) {
    const loot = Math.min(corp.price * corp.shares * rand(0.005, 0.02), 1.4e7);
    P(s).dirty += loot * 0.7;
    P(s).cash += loot * 0.3;
    s.stats.hackerWins += 1;
    corp.price *= 0.88;
    wire(s, `🔐 BREACH CLASSIFIED: ${corp.name} admits "an incident". CISO resigns.`, 'scandal');
    return { ok: true, msg: `☠️ HEIST SUCCESS from ${corp.name}: ${fmt(loot)} (30% clean / 70% dirty).` };
  }
  // failure: traced back
  P(s).hackers = Math.max(0, P(s).hackers - 1);
  const fine = Math.min(P(s).cash, rand(2e5, 1e6) + P(s).heat * 8000);
  P(s).cash -= fine;
  P(s).heat = clamp(P(s).heat + 25, 0, 100);
  s.gov.warrants += 1;
  wire(s, `⚖️ DOJ: cyber-crew charged. An "IT contractor" linked to your org is in cuffs.`, 'scandal');
  return { ok: false, msg: `HEIST FAILED — trace succeeded. -$${fine.toFixed(0)} legal damage, heat +25.` };
}

export function smuggleRun(s) {
  const cost = Math.min(P(s).cash, 75000);
  if (cost <= 0) return { ok: false, msg: 'No seed capital.' };
  P(s).cash -= cost;
  const districts = s.city.districts;
  const lane = pick(districts);
  const bust = clamp(0.12 + lane.crime * 0.3 - (s.gov.privacy ? 0.08 : 0), 0.05, 0.7);
  if (rng() < bust) {
    const seizure = cost * rand(1.5, 2.4);
    P(s).heat = clamp(P(s).heat + 14, 0, 100);
    return { ok: false, msg: `🚔 SMUGGLING BUST in ${lane.name}: cargo ($${seizure.toFixed(0)}) seized.` };
  }
  const yieldAmt = cost * rand(2.2, 4.2) * lane.demand;
  P(s).dirty += yieldAmt;
  P(s).heat = clamp(P(s).heat + 6, 0, 100);
  return { ok: true, msg: `📦 Smuggled through ${lane.name}: ${fmt(yieldAmt)} arrives dirty.` };
}

export function bribeOfficial(s, amount) {
  amount = num(amount);
  if (amount < 50000) return { ok: false, msg: 'Nobody pockets less than $50K.' };
  if (amount > P(s).cash) return { ok: false, msg: 'Insufficient cash.' };
  P(s).cash -= amount;
  s.stats.bribes += 1;
  const heatCut = clamp(amount / 2e6 * 40, 5, 45);
  if (rng() < 0.1 + P(s).heat / 500) {
    P(s).heat = clamp(P(s).heat + 20, 0, 100);
    s.gov.warrants += 1;
    wire(s, `⚖️ CORRUPTION CHARGE: ${s.gov.pending?.name || 'a senator'} flipped states-evidence. Your name is in the ledger.`, 'scandal');
    return { ok: false, msg: 'STING: the official was cooperating with the OCU. Heat +20, warrant issued!' };
  }
  P(s).heat = clamp(P(s).heat - heatCut, 0, 100);
  s.gov.senatorBribed['default'] = (s.gov.senatorBribed['default'] || 0) + 1;
  return { ok: true, msg: `🤝 Paid ${fmt(amount)} to "consultants". Heat -${heatCut.toFixed(0)}.` };
}

// ---------------- portfolio / bank side helpers ----------------
export function toggleMining(s) {
  P(s).miningOn = !P(s).miningOn;
  return { ok: true, msg: `Mining ${P(s).miningOn ? 'ONLINE ⛏️' : 'PAUSED ⏸️'}.` };
}
