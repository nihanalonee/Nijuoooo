/* OMNILIFE media empire: TV networks, shows, propaganda, smear campaigns,
 * fake news and FCC blowback. Moves market.sentiment and target stock prices. */

import { rng, rand, clamp, num, fmt, pick } from './util.js';
import { P, price } from './state.js';
import { wire } from './market.js';

export const NETWORK_COST = 1_800_000;
export const SHOW_COST = { talk: 250000, drama: 800000, news: 550000, shill: 120000 };
export const SHOW_QUALITY = { talk: 0.2, drama: 0.5, news: 0.4, shill: 0.08 };

export function foundNetwork(s, name) {
  if (P(s).media) return { ok: false, msg: 'You already run a network.' };
  if (P(s).cash < NETWORK_COST) return { ok: false, msg: `License costs ${fmt(NETWORK_COST)}.` };
  P(s).cash -= NETWORK_COST;
  P(s).media = {
    name: name || `${s.name.split(' ')[0]} Broadcasting`,
    reach: 0.05,        // share of the public narrative
    shows: [],
    value: NETWORK_COST * 0.8,
    fccHeat: 0,
    episodes: 0,
  };
  return { ok: true, msg: `📡 ${P(s).media.name} is ON AIR. License secured.` };
}

export function greenlightShow(s, type, name) {
  const M = P(s).media;
  if (!M) return { ok: false, msg: 'No network.' };
  const cost = SHOW_COST[type];
  if (!cost) return { ok: false, msg: 'Unknown show type.' };
  if (P(s).cash < cost) return { ok: false, msg: `${fmt(cost)} needed.` };
  if (M.shows.length >= 6) return { ok: false, msg: 'Network at capacity (6 shows). Rake in ad money first.' };
  P(s).cash -= cost;
  const show = {
    id: 'S' + Math.floor(rng() * 1e9).toString(36),
    type, name: name || defaultName(type),
    quality: SHOW_QUALITY[type] * rand(0.7, 1.3),
    buzz: 0,
    ep: 0,
  };
  M.shows.push(show);
  s.stats.shows += 1;
  return { ok: true, msg: `🎬 Greenlit "${show.name}" (${type}).` };
}

function defaultName(type) {
  return pick({
    talk: ['Late Desk', 'Two Drinks In', 'The Basement Tapes'],
    drama: ['Syndicate', 'Emberlow', 'Margin Call Nights'],
    news: ['City Wire Tonight', 'The Ledger', 'Hard Console'],
    shill: ['Moonshot Hour', 'Alpha Grindset', 'Coin Confessions'],
  }[type] || ['Untitled']);
}

/** Air an episode: grows reach & buzz, then fade. Shill shows pump tokens, news can smear. */
export function airShow(s, showId) {
  const M = P(s).media;
  if (!M) return { ok: false, msg: 'No network.' };
  const show = M.shows.find((x) => x.id === showId);
  if (!show) return { ok: false, msg: 'No such show.' };
  const gag = s.gov.mediaGag || 0;
  const budget = Math.min(P(s).cash, Math.max(200000, M.reach * 3e6));
  if (budget <= 0) return { ok: false, msg: 'No budget.' };
  P(s).cash -= budget;
  M.episodes += 1;
  show.ep += 1;
  const bump = (show.quality * rand(0.5, 1.5) + budget / 4e6) * (1 - gag);
  M.reach = clamp(M.reach + bump * 0.03, 0.01, 1);
  show.buzz = clamp(show.buzz + bump * 0.25, 0, 3);
  s.market.sentiment.media = clamp(s.market.sentiment.media + bump * 0.04, 0.05, 0.95);
  M.value = NETWORK_COST * 0.8 + M.reach * 1.4e7;
  P(s).rep = clamp(P(s).rep + bump * 2, 0, 100);

  let extra = '';
  if (show.type === 'shill') {
    // pumps a random token's whale pressure and crypto sentiment
    const t = pick(s.tokens.filter((x) => !x.rugPulled));
    t._whale = clamp((t._whale || 0) + bump * 0.16, -0.3, 0.5);
    s.market.sentiment.crypto = clamp(s.market.sentiment.crypto + bump * 0.05, 0.05, 0.95);
    extra = ` 📈 ${t.sym} shilled to millions.`;
  } else if (show.type === 'news' && rng() < 0.35) {
    const corp = pick(s.corps.filter((c) => c.alive));
    corp.price *= 1 - 0.05 * bump;
    extra = ` 📉 "${show.name}" ran an exposé on ${corp.name} — investors fled.`;
    if (corp.ceo === s.name) { P(s).rep = clamp(P(s).rep - 4, 0, 100); M.fccHeat += 0.5; }
  } else {
    P(s).cash += budget * (0.9 + M.reach) * rand(0.4, 0.9); // ad revenue
    extra = ' ad slots sold.';
  }
  return { ok: true, msg: `Aired ep#${show.ep} of "${show.name}" (reach ${(M.reach * 100).toFixed(0)}%).${extra}` };
}

/** hbo-style dirty ops */
export function smearCampaign(s, targetName, fake) {
  const M = P(s).media;
  if (!M) return { ok: false, msg: 'Own a network first.' };
  const corp = s.corps.find((c) => c.name === targetName && c.alive);
  if (!corp) return { ok: false, msg: 'Target company not found.' };
  if (P(s).cash < 500000) return { ok: false, msg: 'Ops cost $500K min.' };
  P(s).cash -= 500000;
  const gag = s.gov.mediaGag || 0;
  const eff = (M.reach * 1.2 + 0.4) * (fake ? 1.6 : 1) * (1 - gag);
  corp.price *= 1 - 0.08 * eff;
  corp.ctrust = clamp((corp.ctrust || 0.6) - 0.1 * eff, 0.05, 1);
  if (fake) {
    M.fccHeat += 1.2;
    P(s).heat = clamp(P(s).heat + 12, 0, 100);
    if (rng() < 0.25 + gag * 0.2) {
      const fine = Math.min(P(s).cash, 1.2e6 * M.reach);
      P(s).cash -= fine;
      M.fccHeat = Math.max(0, M.fccHeat - 1);
      return { ok: false, msg: `🚨 FCC CAUGHT the fake news: fined ${fmt(fine)}. Narrative damage partial.` };
    }
    wire(s, `📢 ECHO CHAMBER: ${M.name} is pushing an anonymous dossier on ${corp.name}. Analysts call it "fabricated".`);
  } else {
    wire(s, `📰 INVESTIGATIVE UNIT: ${M.name} documents real irregularities at ${corp.name}. Board in crisis.`);
  }
  P(s).rep = clamp(P(s).rep + (fake ? -2 : 3), 0, 100);
  return { ok: true, msg: `Hit landed on ${corp.name}: ${fake ? 'fabricated' : 'investigative'}, effect ${(eff * 100).toFixed(0)}%.` };
}

export function tickMedia(s) {
  const M = P(s).media;
  if (!M) return [];
  const out = [];
  // buzz decays; reach decays without airing
  M.reach = clamp(M.reach * 0.995, 0.01, 1);
  M.value = NETWORK_COST * 0.8 + M.reach * 1.4e7;
  for (const show of M.shows) show.buzz = Math.max(0, show.buzz * 0.97);
  // passive ad revenue proportional to reach
  if (rng() < 0.15) {
    const rev = M.reach * rand(4e4, 2.5e5);
    P(s).cash += rev;
    out.push(`📺 Ad revenue: ${fmt(rev)} on-air.`);
  }
  // FCC pressure can snowball
  if (M.fccHeat > 3 && rng() < 0.04) {
    const fine = Math.min(P(s).cash, 2e6);
    P(s).cash -= fine;
    M.fccHeat = 1;
    out.push(`⚖️ FCC INDICTMENT: ${M.name} fined ${fmt(fine)} for "systemic disinformation".`);
  }
  return out;
}
