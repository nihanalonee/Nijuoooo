/* OMNILIFE city engine: districts & property, ISP backbone, datacenters/mining,
 * and the fractional-reserve banking empire with runs & collapses. */

import { rng, rand, clamp, num, pick, pushCapped, fmt, cfmt } from './util.js';
import { P, price } from './state.js';

// ---------------- districts & property ----------------
export function tickCity(s) {
  const mSent = s.market.sentiment;
  for (const d of s.city.districts) {
    let target = (mSent.media * 0.6 + mSent.crypto * 0.4);
    if (d.id === 'slum') target = 0.3 + d.sentiment * 0.4;
    d.sentiment = clamp(d.sentiment * 0.97 + rand(-0.03, 0.03) + target * 0.03, 0.05, 0.95);
    // property index drifts toward (demand + sentiment - crime pressure)
    const demandPull = d.demand * 0.7 + d.sentiment * 0.8 - d.crime * 0.5;
    d.idx = clamp(d.idx * (1 + (demandPull - 1 + d.fiber * 0.04) * 0.01 + rand(-0.008, 0.008)), 0.15, 6);
    pushCapped(d.hist, d.idx, 140);
  }
  // congestion eases as the city recovers capacity
  const load = 0.25 + s.player.racks * 0.05 + s.npcs.length * 0.05;
  const capacity = 1 + Math.min(6, P(s).fiberTotal || 0);
  s.city.congestion = clamp((load / Math.max(0.4, capacity)) * 0.9 + rand(-0.04, 0.04), 0.05, 2);
}

export function propPrice(d) { return d.base * d.idx; }

export function buyProperty(s, did) {
  const d = s.city.districts.find((x) => x.id === did);
  if (!d) return { ok: false, msg: 'No such district.' };
  const cost = propPrice(d);
  if (P(s).cash < cost) return { ok: false, msg: `${fmt(cost)} needed.` };
  P(s).cash -= cost;
  P(s).props[did] = (P(s).props[did] || 0) + 1;
  d.idx = clamp(d.idx * 1.015, 0.15, 6); // herfindahl squeeze
  return { ok: true, msg: `Acquired property in ${d.name} for ${fmt(cost)}.` };
}

export function rentIncome(s) {
  return s.city.districts.reduce((a, d) => {
    const n = P(s).props[d.id] || 0;
    if (!n) return a;
    // rent scales with sentiment, dented by crime; slums more crime
    return a + n * (propPrice(d) * 0.002) * (0.4 + d.sentiment) * (1 - d.crime * 0.4);
  }, 0);
}

// ---------------- ISP backbone & mining ----------------
export function fiberCost(d) {
  return { fin: 5.5e5, tech: 4.2e5, ind: 2.6e5, port: 3.1e5, slum: 1.4e5, gas: 3.8e5 }[d.id] || 3e5;
}

export function layFiber(s, did) {
  const d = s.city.districts.find((x) => x.id === did);
  if (!d) return { ok: false, msg: 'No such district.' };
  const cost = fiberCost(d);
  if (P(s).cash < cost) return { ok: false, msg: `${fmt(cost)} needed.` };
  P(s).cash -= cost;
  d.fiber += 1;
  refreshFiber(s);
  d.sentiment = clamp(d.sentiment + 0.06, 0.05, 0.95);
  return { ok: true, msg: `Fiber laid in ${d.name}. Backbone +1 lines.` };
}

/** total fiber laid by player across districts */
export function refreshFiber(s) {
  P(s).fiberTotal = s.city.districts.reduce((a, d) => a + d.fiber, 0);
}

export const RACK_COST = 320000;
export function buyRack(s) {
  const cost = RACK_COST * (P(s).racks + 1) ** 1.15;
  if (P(s).cash < cost) return { ok: false, msg: `Next rack costs ${fmt(cost)}.` };
  P(s).cash -= cost;
  P(s).racks += 1;
  return { ok: true, msg: `Server rack installed. Hash rate ${hashRate(s).toFixed(1)} MH/s.` };
}

export function hashRate(s) {
  const fiber = P(s).fiberTotal || 0;
  return P(s).racks * 3.5 * (0.3 + fiber * 0.35);
}

/** Mining: produces the highest-volatility token of the hour; interrupted by outages. */
export function tickMining(s, out = []) {
  if (P(s).outageTicks > 0) P(s).outageTicks -= 1;
  if (!P(s).miningOn || s.player.racks <= 0) return out;
  const uptime = ispUptime(s);
  const target = pick(s.tokens.filter((t) => !t.rugPulled)) || s.tokens[0];
  const mined = hashRate(s) * 0.0009 * uptime * (s.market.congestion > 1.4 ? 0.55 : 1);
  if (mined > 0 && target) {
    P(s).tok[target.sym] = (P(s).tok[target.sym] || 0) + mined;
    out.push(`⛏️ Mined ${cfmt(mined)} ${target.sym} (uptime ${(uptime * 100).toFixed(0)}%)`);
  }
  // random outage when congestion extreme
  if (s.city.congestion > 1.5 && rng() < 0.06) {
    P(s).outageTicks = 12;
    out.push('⚠️ ISP OUTAGE! DDoS flood knocked your datacenter offline for 12 ticks.');
  }
  return out;
}

export function ispUptime(s) {
  if (P(s).outageTicks > 0) return 0;
  const fiber = P(s).fiberTotal || 0;
  const base = 0.35 + Math.min(0.6, fiber * 0.12);
  const attackRisk = P(s).heat / 100 * 0.25;
  return clamp(base + (P(s).racks > 3 ? 0.1 : 0) - attackRisk, 0.05, 0.99);
}

// ---------------- banking empire ----------------
export const BANK_FOUND_COST = 3_500_000;

export function foundBank(s, name) {
  if (P(s).bank) return { ok: false, msg: 'You already operate a bank.' };
  if (P(s).cash < BANK_FOUND_COST) return { ok: false, msg: `Charter costs ${fmt(BANK_FOUND_COST)}.` };
  P(s).cash -= BANK_FOUND_COST;
  // seed deposits so the chartered bank isn't empty on day one
  const deposits = rand(3e6, 6e6);
  P(s).bank = {
    name: name || `${s.name.split(' ')[0]} Trust`,
    charter: Date.now(),
    deposits,
    reserve: deposits * 0.42,   // healthy initial reserves
    lent: 0,
    loanBook: [],
    rate: 0.06,                // annual % advertised to depositors
    underwrite: 'balanced',    // predatory | balanced | secured
    equity: deposits * 0.2,
    runRisk: 0.02,
    failed: false,
    depositors: rand(40, 120),
  };
  return { ok: true, msg: `🏦 ${P(s).bank.name} chartered. Fractional reserves ACTIVE.` };
}

export function tickBank(s, out = []) {
  const b = P(s).bank;
  if (!b || b.failed) return out;
  // depositors come & go, attracted by your rate vs gov bond ~4%
  const attract = (b.rate - 0.04) * 2;
  const flow = b.deposits * clamp(0.004 * (1 + attract) + rand(-0.006, 0.004), -0.02, 0.03);
  b.deposits = Math.max(0, b.deposits + flow);
  b.reserve -= Math.min(b.reserve, Math.max(0, flow) * (rng() < 0.5 ? 1 : 0.4)); // deposit ops cost cash to service
  // loan book accrues interest; defaults depend on underwriting aggression
  let interest = 0, defaults = 0, defaultAmt = 0;
  for (const L of b.loanBook) {
    if (L.repaid) continue;
    L.ticks -= 1;
    interest += L.principal * (L.rate / 720);      // per-tick amortization
    const defaultChance = (L.risk * 0.02) + (s.market.sentiment.crypto < 0.3 ? 0.02 : 0);
    if (L.ticks <= 0 || rng() < defaultChance) {
      if (L.ticks <= 0 && rng() > 0.1) {
        L.repaid = true;
        b.reserve += L.principal * L.rate * (L.term / 720);
      } else {
        defaults += 1; defaultAmt += L.principal * 0.65;
        L.repaid = true; // written off
      }
    }
  }
  b.reserve = Math.max(0, b.reserve + interest);
  if (defaultAmt) {
    b.loanBook = b.loanBook.filter((x) => !x.repaid);
    b.equity = Math.max(0, b.equity - defaultAmt * 0.3);
    out.push(`💀 Defaulted ${defaults} loans ($${defaultAmt.toFixed(0)} hit to equity).`);
  }
  // liquidity crunch & run risk
  const reserveRatio = b.reserve / Math.max(1, b.deposits);
  b.runRisk = clamp(0.02 + (0.45 - reserveRatio) * 0.9 + (P(s).heat > 60 ? 0.2 : 0), 0, 0.95);
  if (reserveRatio < 0.22 && rng() < 0.02) {
    const drain = b.deposits * rand(0.15, 0.4);
    if (drain > b.reserve) {
      out.push(bankCollapse(s, drain));
    } else {
      b.deposits -= drain; b.reserve -= drain;
      out.push(`🚨 BANK RUN: panicked depositors withdrew ${fmt(drain)}. Reserves down to ${fmt(b.reserve)}.`);
    }
  }
  // daily bread of commercial lending income on lent book
  if (reserveRatio > 0.5 && rng() < 0.02) {
    const newLoan = rand(2e5, 1.2e6);
    b.loanBook.push({
      id: 'L' + Math.floor(rng() * 1e6), principal: newLoan,
      rate: 0.08 + (b.underwrite === 'predatory' ? 0.06 : 0.02),
      risk: b.underwrite === 'predatory' ? rand(0.7, 1) : b.underwrite === 'secured' ? rand(0.02, 0.15) : rand(0.2, 0.5),
      term: rand(400, 1400), ticks: rand(400, 1400),
      borrower: pick(['Emberlow Freight Co.', 'Silica Robotics', 'Harbor Logistics', 'Vecna subcontractor', 'Orbital Foods']),
      repaid: false,
    });
    b.lent += newLoan;
    out.push(`💼 Underwrote loan: ${fmt(newLoan)} to ${b.loanBook.at(-1).borrower}.`);
  }
  // equity tracks reserves minus obligations
  b.equity = clamp(Math.max(b.reserve, 0) * 0.35 + b.lent * 0.05, 0, b.deposits);
  return out;
}

function bankCollapse(s, drain) {
  const b = P(s).bank;
  b.failed = true;
  b.equity = 0;
  P(s).rep = clamp(P(s).rep - 25, 0, 100);
  P(s).heat = clamp(P(s).heat + 10, 0, 100);
  s.gov.bailouts += 1;
  s.stats.bailouts = (s.stats.bailouts || 0) + 1;
  const restitution = Math.min(b.deposits, 1e6); // partial insurance payout
  P(s).cash += restitution;
  b.deposits = 0; b.reserve = 0;
  return `🏦 BANKRUPTCY! ${b.name} could not cover withdrawals. Government drags out a bailout (#${s.gov.bailouts}). Insured only ${fmt(restitution)} back to you.`;
}

export function setRate(s, r) {
  const b = P(s).bank;
  if (!b || b.failed) return { ok: false, msg: 'No bank.' };
  b.rate = clamp(r, 0, 25);
  return { ok: true, msg: `Deposit rate set to ${b.rate.toFixed(2)}%.` };
}

export function setPolicy(s, mode) {
  const b = P(s).bank;
  if (!b) return { ok: false, msg: 'No bank.' };
  if (!['predatory', 'balanced', 'secured'].includes(mode)) return { ok: false, msg: 'Unknown policy.' };
  b.underwrite = mode;
  return { ok: true, msg: `Underwriting policy: ${mode.toUpperCase()}.` };
}

export function recap(s, amount) {
  const b = P(s).bank;
  amount = num(amount);
  if (!b) return { ok: false, msg: 'No bank.' };
  if (amount <= 0 || amount > P(s).cash) return { ok: false, msg: 'Bad recap amount.' };
  P(s).cash -= amount;
  b.reserve += amount;
  b.runRisk = clamp(b.runRisk - 0.1, 0, 1);
  return { ok: true, msg: `Recapitalized with ${fmt(amount)}.` };
}
