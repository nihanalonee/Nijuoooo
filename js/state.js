/* OMNILIFE: THE SYNDICATE - global simulation state, persistence, world data */

import { seedRng, rng, pick, sum } from './util.js';

export const SAVE_KEY = 'omnilife.save.v1';
export const GOD_EMAIL = 'mirajx132@gmail.com';

/** District archetypes of the Living City */
export const DISTRICTS = [
  { id: 'fin', name: 'Financial Quarter', emoji: '🏙️', base: 3.2e6, crime: 0.10, demand: 0.9 },
  { id: 'tech', name: 'Silica Heights (Tech Hub)', emoji: '💠', base: 2.4e6, crime: 0.06, demand: 1.0 },
  { id: 'ind', name: 'Rustworks (Industrial)', emoji: '⚙️', base: 9.5e5, crime: 0.22, demand: 0.55 },
  { id: 'port', name: 'Old Harbor', emoji: '⚓', base: 1.3e6, crime: 0.30, demand: 0.6 },
  { id: 'slum', name: 'The Emberlow Slums', emoji: '🏚️', base: 3.2e5, crime: 0.55, demand: 0.4 },
  { id: 'gas', name: 'Neongas Strip', emoji: '🎰', base: 1.8e6, crime: 0.35, demand: 0.75 },
];

/** Starter tokens on the DEX (player can mint more in Crypto Lab) */
export const START_TOKENS = [
  { sym: 'WUSD', name: 'Wruseless Dollar', supply: 8e8, liq: 5.5e6, vol: 0.010, bias: 0.00000 },
  { sym: 'CHAD', name: 'Chadfather Coin', supply: 4.2e8, liq: 3.8e6, vol: 0.030, bias: 0.00008 },
  { sym: 'NEUR', name: 'NeuraNet Token', supply: 2.5e8, liq: 6.4e6, vol: 0.022, bias: 0.00010 },
  { sym: 'OBEY', name: 'Obey Media Credits', supply: 3.0e8, liq: 2.1e6, vol: 0.035, bias: 0.00004 },
  { sym: 'GRFT', name: 'GraftCoin', supply: 5e8, liq: 1.2e6, vol: 0.045, bias: 0.00012 },
];

/** Rival masterminds — autonomous agents wired into the World Engine */
export const RIVALS = [
  { id: 'r_lex', name: 'Alexandra "Lex" Roth', archetype: 'Old Money', emoji: '🍸',
    traits: { greed: 0.45, aggression: 0.35, candor: 0.7 }, seedMoney: 2.6e9 },
  { id: 'r_chad', name: 'Brocktionel "The Chadfather"', archetype: 'Crypto Whale', emoji: '🐋',
    traits: { greed: 0.95, aggression: 0.8, candor: 0.15 }, seedMoney: 7.4e8 },
  { id: 'r_aya', name: 'Dr. Aya Okonkwo', archetype: 'AI Tech Mogul', emoji: '🧠',
    traits: { greed: 0.6, aggression: 0.25, candor: 0.55 }, seedMoney: 4.1e9 },
  { id: 'r_ser', name: 'Selene Kadream', archetype: 'Media Baroness', emoji: '📺',
    traits: { greed: 0.65, aggression: 0.7, candor: 0.3 }, seedMoney: 3.2e9 },
  { id: 'r_del', name: 'Don Reyes del Río', archetype: 'Cartel Financier', emoji: '💀',
    traits: { greed: 0.85, aggression: 0.9, candor: 0.1 }, seedMoney: 1.8e9 },
  { id: 'r_yok', name: 'Chairman Yokozuna', archetype: 'Reform Senator', emoji: '🏛️',
    traits: { greed: 0.3, aggression: 0.4, candor: 0.85 }, seedMoney: 5.5e9 },
];

/** Laws the Senate periodically forces onto the world */
export const LAW_POOL = [
  { id: 'crypto', name: 'Digital Asset Surveillance Act', desc: 'DEX trades taxed +2% for all players', cost: null },
  { id: 'bank', name: 'Basel-X Reserve Mandate', desc: 'Banks must hold +20% more liquidity reserves', cost: null },
  { id: 'media', name: 'Truth-in-Broadcast Act', desc: 'Fake-news ops fined; propaganda 50% weaker', cost: null },
  { id: 'tax', name: 'Wealth Windfall Levy', desc: 'Government harvests 10% of profits from rich tycoons', cost: null },
  { id: 'privacy', name: 'Total Privacy Deregulation', desc: 'All crime ops 30% more likely to succeed', cost: 'bribe' },
  { id: 'gamble', name: 'Casino Zones Act', desc: 'Neongas Strip property values +25%', cost: 'bribe' },
];

// ---------------- state factory ----------------
export function defaultState({ name, email, god }) {
  seedRng((Date.now() ^ (name.length * 7919)) >>> 0);

  const tokens = START_TOKENS.map((t) => {
    const tokRes = t.supply / 2; // half the supply backs the initial pool
    const cashRes = t.liq * 2;
    return {
      id: 't_' + t.sym.toLowerCase(),
      name: t.name,
      sym: t.sym,
      creator: 'OmniFund',
      minted: t.supply,
      pool: { cash: cashRes, tok: tokRes },
      staked: 0,
      p0: cashRes / tokRes,
      hist: [cashRes / tokRes],
      rugPulled: false,
    };
  });

  const corps = [
    { id: 'c_neuras', name: 'Neuras Systems', sector: 'AI Compute', ceo: 'Dr. Aya Okonkwo', shares: 220e6, price: 14.5, drift: 0.0022, vol: 0.016, hist: [14.5], alive: true },
    { id: 'c_horizon', name: 'Horizon Broadcast Group', sector: 'Media', ceo: 'Selene Kadream', shares: 180e6, price: 9.1, drift: 0.0012, vol: 0.02, hist: [9.1], alive: true },
    { id: 'c_vecna', name: 'Vecna Defense', sector: 'Ordnance', ceo: 'Lex Roth', shares: 90e6, price: 31.2, drift: 0.0015, vol: 0.024, hist: [31.2], alive: true },
    { id: 'c_helio', name: 'HelioMart', sector: 'Retail', ceo: 'Brocktionel', shares: 400e6, price: 4.8, drift: 0.0008, vol: 0.02, hist: [4.8], alive: true },
  ];

  // special-case the stablecoin: seed it exactly at its $1 peg
  const wusd = tokens.find((t) => t.sym === 'WUSD');
  if (wusd) {
    wusd.pool.tok = wusd.pool.cash;
    wusd.p0 = 1;
    wusd.hist = [1];
  }

  const npcs = RIVALS.map((r) => ({
    ...r, money: r.seedMoney,
    holdings: {}, // sym -> tokens
    stock: {},
    heat: 0,
    nextActIn: 4 + Math.floor(rng() * 14),
    mood: 'hoarding',
  }));

  return {
    v: 1,
    started: Date.now(),
    email,
    name,
    god: !!god,
    tick: 0,
    speed: 1, // 0 paused, 1, 2, 4
    player: {
      cash: 800000,
      dirty: 0,
      heat: 0,
      rep: 50,          // 0-100 public opinion
      tok: {},          // sym -> units held
      staked: {},       // sym -> units staked
      lp: {},           // sym -> USD-worth of LP position
      shares: {},       // corp id -> shares
      props: {},        // district id -> count
      racks: 1,
      miningOn: true,
      bank: null,       // BankEmpire
      media: null,      // MediaEmpire
    },
    tokens,
    corps,
    npcs,
    wire: [],
    log: [],
    stats: { traded: 0, laundered: 0, hackerWins: 0, bribes: 0, shows: 0 },
    city: {
      districts: DISTRICTS.map((d, i) => ({
        ...d,
        idx: d.base / DISTRICTS[i].base, // normalized price index (start ~1)
        sentiment: 0.5,
        fiber: 0,        // player fiber lines here
        hist: [1],
      })),
      congestion: 0.3, // 0..2 network load vs capacity
    },
    gov: {
      tax: 0.15,
      heat: 28,
      senatorBribed: {},
      law: null,
      lawIn: 30,
      pending: null,
      warrants: 0,
      bailouts: 0,
    },
    market: {
      congestion: 0.3,
      gasFee: 42,
      sentiment: { crypto: 0.52, media: 0.5 },
      stakers: {},
      supplyIdx: 1,
    },
    media: {},
    criminals: [],
  };
}

// ---------------- load/save ----------------
export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.player || !s.tokens) return null;
    seedRng(s.started >>> 0);
    return s;
  } catch { return null; }
}

export function saveState(s) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function wipeState() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// Convenience accessors used by multiple modules
export const P = (s) => s.player;
export const findTok = (s, sym) => s.tokens.find((t) => t.sym === sym);
export const price = (t) => t.pool.cash / Math.max(1e-9, t.pool.tok);
export const netWorth = (s) =>
  P(s).cash + P(s).dirty * 0 + sum(s.tokens, (t) => (+P(s).tok[t.sym] || 0) * price(t))
  + sum(s.corps, (c) => (+P(s).shares[c.id] || 0) * (c.alive ? c.price : 0))
  + sum(s.city.districts, (d) => (+P(s).props[d.id] || 0) * d.base * d.idx)
  + (P(s).bank ? P(s).bank.equity : 0)
  + (P(s).media ? P(s).media.value : 0)
  + (P(s).racks || 0) * 125000; // datacenter racks hold book value
