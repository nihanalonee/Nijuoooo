/* OMNILIFE market engine: AMM DEX, stocks, gas & network congestion.
 * Pure math over state; no DOM. Player-side wrappers live in actions.js. */

import { rng, rand, pick, clamp, num, pushCapped, cfmt } from './util.js';
import { P, findTok, price } from './state.js';

// ---------------- AMM ----------------
const FEE = 0.003;

/** How much OUTPUT you get for an exact INPUT (constant product). */
export function quote(pool, inCash, isBuy) {
  const k = Math.max(1e-9, pool.cash * pool.tok);
  if (isBuy) {
    const cashIn = Math.max(0, num(inCash));
    const tokOut = pool.tok - k / (pool.cash + cashIn * (1 - FEE));
    return { out: Math.max(0, tokOut), avgPrice: cashIn / Math.max(1e-12, tokOut) };
  }
  const tokIn = Math.max(0, num(inCash));
  const cashOut = pool.cash - k / (pool.tok + tokIn * (1 - FEE));
  return { out: Math.max(0, cashOut), avgPrice: cashOut / Math.max(1e-12, tokIn) };
}

/** Raw mid price with optional congestion slippage applied to execution. */
export function execSlippage(s) {
  const c = s.market.congestion; // 0..2
  return 1 + 0.035 * c;          // up to ~7% execution penalty
}

export function buyToken(s, sym, cashIn, { gas = true } = {}) {
  const t = findTok(s, sym);
  if (!t || t.rugPulled) return { ok: false, msg: `${sym} has no liquidity (rug pulled)` };
  cashIn = num(cashIn);
  if (cashIn <= 0) return { ok: false, msg: 'Enter an amount.' };
  if (cashIn > P(s).cash) return { ok: false, msg: 'Insufficient clean cash.' };
  const gasCost = gas ? s.market.gasFee : 0;
  const total = cashIn + gasCost;
  if (total > P(s).cash) return { ok: false, msg: `Not enough for ${cashIn} + gas (${gasCost}).` };
  const slip = execSlippage(s);
  const q = quote(t.pool, cashIn, true);
  const tokOut = q.out / slip;
  if (tokOut <= 0) return { ok: false, msg: 'Quote failed.' };
  P(s).cash -= total;
  t.pool.cash += cashIn;
  t.pool.tok -= tokOut;
  P(s).tok[sym] = (P(s).tok[sym] || 0) + tokOut;
  s.stats.traded += 1;
  return { ok: true, msg: `Bought ${cfmt(tokOut)} ${sym} @ ${cfmt(q.avgPrice / slip)} avg` };
}

export function sellToken(s, sym, tokIn, { gas = true } = {}) {
  const t = findTok(s, sym);
  if (!t || t.rugPulled) return { ok: false, msg: `${sym} has no liquidity (rug pulled)` };
  tokIn = num(tokIn);
  const held = P(s).tok[sym] || 0;
  if (tokIn <= 0) return { ok: false, msg: 'Enter an amount.' };
  if (tokIn > held) return { ok: false, msg: `You only have ${cfmt(held)} ${sym}.` };
  const gasCost = gas ? s.market.gasFee : 0;
  const gross = quote(t.pool, tokIn, false).out;
  const pExec = price(t) * execSlippage(s);
  // profit-only capital gains tax versus minter-era baseline
  const basis = (P(s).basis?.[sym]) || t.p0;
  const isGain = pExec > basis;
  const taxDue = isGain ? gross * s.gov.tax * 0.5 : 0;
  const netCash = Math.max(0, gross - taxDue);
  P(s).tok[sym] = held - tokIn;
  if (P(s).tok[sym] < 1e-9) delete P(s).tok[sym];
  t.pool.tok += tokIn;
  t.pool.cash -= gross;
  P(s).cash += netCash - gasCost;
  s.stats.traded += 1;
  return {
    ok: true,
    msg: `Sold ${cfmt(tokIn)} ${sym} → $${netCash.toFixed(0)}` +
      (taxDue > 0 ? ` (cap-gains tax ${(s.gov.tax * 50).toFixed(0)}%)` : ''),
  };
}

// ---------------- liquidity & staking ----------------
export function addLiquidity(s, sym, cashIn) {
  const t = findTok(s, sym);
  cashIn = num(cashIn);
  if (!t || t.rugPulled) return { ok: false, msg: 'Pool unavailable.' };
  if (cashIn <= 0 || cashIn > P(s).cash) return { ok: false, msg: 'Insufficient cash.' };
  const p = price(t);
  const tokIn = cashIn / Math.max(1e-12, p);
  t.pool.cash += cashIn;
  t.pool.tok += tokIn;
  P(s).cash -= cashIn;
  P(s).lp[sym] = (P(s).lp[sym] || 0) + cashIn;
  return { ok: true, msg: `Added liquidity: ${cashIn.toFixed(0)} USD-worth @ ${cfmt(p)}` };
}

export function removeLiquidity(s, sym, share) {
  const t = findTok(s, sym);
  const put = P(s).lp[sym] || 0;
  if (!t || put <= 0) return { ok: false, msg: 'No liquidity position.' };
  const take = clamp(share, 0.05, 1) * put;
  const p = price(t);
  const cashOut = take * 1.02; // fees earned
  const cash = Math.min(cashOut, t.pool.cash);
  const tokBack = cash / Math.max(1e-12, p);
  t.pool.cash -= cash;
  t.pool.tok -= tokBack;
  P(s).lp[sym] = put - take;
  if (P(s).lp[sym] < 1e-9) delete P(s).lp[sym];
  P(s).cash += cash;
  P(s).tok[sym] = (P(s).tok[sym] || 0) + tokBack;
  return { ok: true, msg: `Withdrew liquidity → ${cfmt(tokBack)} ${sym} (+fees)` };
}

export function stake(s, sym, tokIn) {
  const held = P(s).tok[sym] || 0;
  tokIn = num(tokIn);
  if (tokIn <= 0 || tokIn > held) return { ok: false, msg: `Stake <= balance (${cfmt(held)}).` };
  P(s).tok[sym] = held - tokIn;
  P(s).staked[sym] = (P(s).staked[sym] || 0) + tokIn;
  const t = findTok(s, sym);
  if (t) t.staked += tokIn;
  return { ok: true, msg: `Staked ${cfmt(tokIn)} ${sym}.` };
}

export function unstake(s, sym, share = 1) {
  const st = P(s).staked[sym] || 0;
  const out = st * clamp(share, 0.01, 1);
  if (out <= 0) return { ok: false, msg: 'Nothing staked.' };
  P(s).staked[sym] = st - out;
  if (P(s).staked[sym] < 1e-9) delete P(s).staked[sym];
  P(s).tok[sym] = (P(s).tok[sym] || 0) + out;
  const t = findTok(s, sym);
  if (t) t.staked = Math.max(0, t.staked - out);
  return { ok: true, msg: `Unstaked ${cfmt(out)} ${sym}.` };
}

/** Mint a brand new meme coin with an initial AMM pool. */
export function mintToken(s, { sym, name, supply, liquidity }) {
  sym = String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sym.length < 2 || sym.length > 6) return { ok: false, msg: 'Symbol must be 2-6 letters.' };
  if (findTok(s, sym)) return { ok: false, msg: `Symbol ${sym} already exists.` };
  supply = clamp(num(supply, 1e8), 1e4, 1e12);
  liquidity = clamp(num(liquidity, 2e5), 1000, P(s).cash);
  if (liquidity < 1000) return { ok: false, msg: 'Need at least $1K liquidity.' };
  if (liquidity > P(s).cash) return { ok: false, msg: 'Not enough cash.' };
  const tokRes = supply / 2;
  const t = {
    id: 't_' + sym.toLowerCase(),
    sym, name: name || sym + ' Coin',
    creator: s.name,
    minted: supply,
    pool: { cash: liquidity, tok: tokRes },
    staked: 0,
    p0: liquidity / tokRes,
    hist: [liquidity / tokRes],
    rugPulled: false,
  };
  s.tokens.push(t);
  P(s).cash -= liquidity;
  P(s).tok[sym] = tokRes; // creator keeps the circulating half
  return { ok: true, msg: `${sym} is LIVE. Pool: ${(liquidity / tokRes).toFixed(6)} start price. You hold 50%.`, tok: t };
}

/** Rug pull: drain your own pool. Brutal heat, token dies. */
export function rugPull(s, sym) {
  const t = findTok(s, sym);
  if (!t) return { ok: false, msg: 'Unknown token.' };
  if (t.creator !== s.name) return { ok: false, msg: 'You did not mint this coin.' };
  if (t.rugPulled) return { ok: false, msg: 'Already rugged.' };
  const loot = t.pool.cash * 0.92;
  t.rugPulled = true;
  P(s).dirty += loot;
  P(s).heat = clamp(P(s).heat + 38, 0, 100);
  if (P(s).heat > 70) s.gov.warrants += 1;
  return { ok: true, msg: `🚨 RUG PULLED ${sym}: embezzled $${loot.toFixed(0)} into dirty cash.`, tok: t };
}

/** Flash-loan attack: borrow, dump, repay in one tick. High risk/reward. */
export function flashLoan(s, sym) {
  const t = findTok(s, sym);
  if (!t || t.rugPulled) return { ok: false, msg: 'Pool unavailable.' };
  const power = clamp(s.market.gasFee / 60, 0.5, 3) * (1 + s.market.congestion);
  if (rng() > 0.55 + 0.15 * power) {
    // repriced against you: liquidation
    const loss = P(s).cash * rand(0.12, 0.4);
    P(s).cash -= loss;
    P(s).heat = clamp(P(s).heat + 8, 0, 100);
    return { ok: false, msg: `Flash loan FAILED — MEV bots front-ran you for $${loss.toFixed(0)}.` };
  }
  // success: extract value from the pool
  const loot = Math.min(t.pool.cash * 0.18, 2e7);
  t.pool.cash -= loot;
  t.pool.tok *= 1.4; // price impact collapses the pool
  P(s).dirty += loot * 0.6;
  P(s).cash += loot * 0.4;
  P(s).heat = clamp(P(s).heat + 16, 0, 100);
  return { ok: true, msg: `⚡ FLASH ATTACK: extracted $${loot.toFixed(0)} (40% clean / 60% dirty).` };
}

// ---------------- stocks (secondary market) ----------------
export function tickStocks(s) {
  const mSent = s.market.sentiment;
  for (const c of s.corps) {
    if (!c.alive) continue;
    const ceo = s.npcs.find((n) => n.name === c.ceo);
    const hype = ceo ? (ceo.mood === 'aggressive' ? 0.35 : ceo.mood === 'normal' ? 0 : -0.2) : 0;
    const drift = c.drift + (mSent.media - 0.5) * 0.004 + hype * 0.003;
    const shock = rng() < 0.02 ? rand(-0.09, 0.09) : 0;
    c.price = Math.max(0.05, c.price * (1 + drift + shock + rand(-c.vol, c.vol)));
    pushCapped(c.hist, c.price, 140);
    if (c.price < 0.5 && rng() < 0.05) {
      c.alive = false;
      wire(s, `📰 WIRE: ${c.name} ($${c.price.toFixed(2)}) files for bankruptcy. Shareholders wiped.`, 'scandal');
      s.player.shares[c.id] = 0;
    }
  }
}

export function buyStock(s, cid, shares) {
  const c = s.corps.find((x) => x.id === cid);
  if (!c || !c.alive) return { ok: false, msg: 'Not trading.' };
  shares = Math.floor(num(shares));
  if (shares <= 0) return { ok: false, msg: 'Enter share count.' };
  const cost = shares * c.price * (1 + 0.002);
  if (cost > P(s).cash) return { ok: false, msg: `Cost $${cost.toFixed(0)} — insufficient.` };
  P(s).cash -= cost;
  P(s).shares[cid] = (P(s).shares[cid] || 0) + shares;
  s.stats.traded += 1;
  return { ok: true, msg: `Bought ${shares} sh ${c.name} @ ${c.price.toFixed(2)}` };
}

export function sellStock(s, cid, share = 1) {
  const c = s.corps.find((x) => x.id === cid);
  const held = P(s).shares[cid] || 0;
  if (!c || held <= 0) return { ok: false, msg: 'No position.' };
  const out = Math.ceil(held * clamp(share, 0.05, 1));
  const gross = out * c.price;
  const net = gross * (1 - s.gov.tax * 0.5);
  P(s).shares[cid] = held - out;
  if (P(s).shares[cid] <= 0) delete P(s).shares[cid];
  P(s).cash += net;
  s.stats.traded += 1;
  return { ok: true, msg: `Sold ${out} sh ${c.name} → ${net.toFixed(0)}` };
}

/** Found a public company as the player. */
export const FOUND_COST = 2_500_000;
export function foundCorp(s, name, sector) {
  if (P(s).cash < FOUND_COST) return { ok: false, msg: `Need ${FOUND_COST.toLocaleString()} to go public.` };
  if (!name) return { ok: false, msg: 'Name required.' };
  P(s).cash -= FOUND_COST;
  const c = {
    id: 'c_' + name.toLowerCase().replace(/\W+/g, '').slice(0, 12) + '_' + Math.floor(rng() * 999),
    name, sector: sector || 'Conglomerate', ceo: s.name,
    shares: 120e6, price: 10, drift: 0.0018, vol: 0.02, hist: [10], alive: true, playerOwned: true,
  };
  s.corps.push(c);
  P(s).rep = clamp(P(s).rep + 6, 0, 100);
  return { ok: true, msg: `${name} IPO'd at $10.00 — you hold 100% (120M sh).`, corp: c };
}

// ---------------- World Engine market tick ----------------
export function tickTokens(s) {
  const congestion = s.city.congestion;
  s.market.congestion = clamp(0.15 + s.player.racks * 0.02 + (congestion - 0.3) * 0.6, 0.05, 2);

  // gas fee: congestion-driven
  s.market.gasFee = Math.round(clamp(18 + s.market.congestion * 55, 8, 220));

  for (const t of s.tokens) {
    if (t.rugPulled) { t.hist.push(0); if (t.hist.length > 140) t.hist.shift(); continue; }
    const tv = t.vol || 0.02;
    // systemic drift + noise + whale pressure
    const bias = (t.bias || 0) * (s.market.sentiment.crypto - 0.3) * 8;
    // occasional whale pump/dump from rival traders (mounted by npcs module via flag)
    const whale = t._whale || 0; t._whale = 0;
    let dp = bias + rand(-tv, tv) * (0.6 + s.market.congestion * 0.3) + whale;
    if (Math.abs(dp) > 0.35) dp = Math.sign(dp) * 0.35;
    // stablecoin mean-reversion to $1 before flow is applied
    let pOld = price(t);
    if (t.sym === 'WUSD') {
      dp += (1 - pOld) * 0.25 + rand(-0.001, 0.001);
      pOld = Math.max(1e-8, pOld * (1 + dp));
    }
    // pool-based price update (simulate flow through pool)
    const flowCash = t.pool.cash * dp * 0.5;
    t.pool.cash = Math.max(t.pool.cash * 0.999, t.pool.cash + flowCash);
    const pNew = price(t);
    pushCapped(t.hist, pNew, 140);
    // staking yield accrual (percentage yield paid in-kind to all stakers simplified to player)
    if (t.staked > 0) {
      const y = t.staked * 0.00035;
      const playerStake = s.player.staked[t.sym] || 0;
      if (playerStake > 0) {
        const share = playerStake / Math.max(1e-9, t.staked);
        s.player.staked[t.sym] = playerStake + y * share;
      }
      t.staked += y * 0.4; // protocol rewards expand staked balance
    }
  }
  // market sentiment slowly random-walks
  for (const k in s.market.sentiment) {
    s.market.sentiment[k] = clamp(s.market.sentiment[k] + rand(-0.012, 0.012), 0.05, 0.95);
  }
}

/** Feed helpers used by npcs/world modules */
export function wire(s, text, kind = 'info') {
  s.wire.push({ t: s.tick, text, kind });
  if (s.wire.length > 260) s.wire.splice(0, s.wire.length - 260);
}
