/* OMNILIFE God Protocol: Server Admin terminal.
 * Unlocked when the profile email is mirajx132@gmail.com (per master spec §8).
 * Players who match get a command console over the entire simulation:
 * spawn trillions, pump/crash markets, sway laws, wipe entities, smite NPCs. */

import { clamp, num, fmt } from './util.js';
import { P, findTok, price } from './state.js';

export const HELP = [
  'help                      — list commands',
  'cash <amount>             — add clean cash (e.g. cash 1T)',
  'dirty <amount>            — add dirty cash',
  'heat <0-100>              — set your police heat',
  'tax <0.05-1>              — set world tax rate',
  'pump <SYMBOL> <pct>       — pump a token (pump CHAD 200)',
  'crash <SYMBOL> <pct>      — crash a token (crash CHAD 90)',
  'rug <SYMBOL>              — instantly rug any pool',
  'kill <company name>       — bankrupt a corporation',
  'bailout                   — force a mega-bank bailout narrative',
  'pass | reject             — force the pending Senate vote',
  'smite <rival name>        — delete a rival mastermind',
  'spawn <item: rack|fiber|network|bank> — instantly own infrastructure',
  'wipe                      — erase the save and reboot the world',
];

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

function parseAmount(str) {
  if (!str) return NaN;
  const m = String(str).trim().toLowerCase().match(/^([\d.]+)\s*([kmbt]?)$/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (SUFFIX[m[2] || ''] || 1);
}

export function runGod(s, raw) {
  const line = raw.trim();
  if (!line) return { out: '⚠ empty command' };
  const [cmd, ...args] = line.split(/\s+/);
  const a0 = (args[0] || '').toLowerCase();
  switch (cmd.toLowerCase()) {
    case 'help':
      return { out: HELP.map((x) => '  ' + x).join('\n') };

    case 'cash': {
      const v = parseAmount(args[0]);
      if (!Number.isFinite(v)) return { out: '⚠ usage: cash 5.5B' };
      P(s).cash += v;
      return { out: `✔ minted ${fmt(v)} clean cash. Inflation: your problem now.` };
    }
    case 'dirty': {
      const v = parseAmount(args[0]);
      if (!Number.isFinite(v)) return { out: '⚠ usage: dirty 4B' };
      P(s).dirty += v;
      return { out: `✔ ${fmt(v)} dirty funds materialized off-ledger.` };
    }
    case 'heat': {
      const v = clamp(parseFloat(args[0]) || 0, 0, 100);
      P(s).heat = v;
      return { out: `✔ heat set to ${v}.` };
    }
    case 'tax': {
      const v = clamp(parseFloat(args[0]) || 0.15, 0.01, 1);
      s.gov.tax = v;
      return { out: `✔ world tax rate set to ${(v * 100).toFixed(0)}%.` };
    }
    case 'pump': case 'crash': {
      const t = findTok(s, a0.toUpperCase());
      if (!t) return { out: `⚠ token ${a0.toUpperCase()} not found. Try: ${s.tokens.map((x) => x.sym).join(' ')}` };
      const p = clamp(parseFloat(args[1]) / 100 || 0.5, 0.01, 10);
      if (cmd === 'pump') t.pool.cash *= 1 + p * 2;
      else if (t.rugPulled) return { out: '⚠ already rugged' };
      else {
        t.pool.cash *= Math.max(0.02, 1 - p);
        t.pool.tok *= 1 + p;
      }
      return { out: `✔ ${cmd.toUpperCase()} ${t.sym} executed. The tape is chaos.` };
    }
    case 'rug': {
      const t = findTok(s, a0.toUpperCase());
      if (!t) return { out: '⚠ unknown symbol' };
      t.rugPulled = true;
      t.pool.cash = 0;
      return { out: `✔ ${t.sym} rugged. Holders rekt. Be proud.` };
    }
    case 'kill': {
      const name = args.join(' ').toLowerCase();
      const c = s.corps.find((x) => x.alive && x.name.toLowerCase().includes(name));
      if (!c) return { out: '⚠ company not found' };
      c.alive = false; c.price = 0.01;
      return { out: `✔ ${c.name} liquidated via God fiat.` };
    }
    case 'bailout': {
      s.gov.bailouts += 1;
      if (P(s).bank) P(s).bank.reserve += P(s).bank.deposits;
      P(s).cash += 2.5e9;
      return { out: '✔ Senate approved an "emergency liquidity" package. $2.5B routes to you. "(totally legit)"' };
    }
    case 'pass': case 'reject': {
      if (!s.gov.pending) return { out: '⚠ no pending law' };
      s.gov.pending.support = cmd === 'pass' ? 0.99 : 0.01;
      s.forcedVote = true;
      return { out: `✔ Senate whipped to ${cmd} the docket.` };
    }
    case 'smite': {
      const name = args.join(' ').toLowerCase();
      const i = s.npcs.findIndex((n) => n.name.toLowerCase().includes(name));
      if (i < 0) return { out: '⚠ rival not found' };
      const [gone] = s.npcs.splice(i, 1);
      return { out: `✔ ${gone.name} has been erased from the timeline.` };
    }
    case 'spawn': {
      switch (a0) {
        case 'rack': P(s).racks += 10; return { out: '✔ 10 racks materialized.' };
        case 'fiber':
          for (const d of s.city.districts) d.fiber += 2;
          return { out: '✔ fiber doubled in every district.' };
        case 'network': P(s).media = { name: 'OMNI TV', reach: 0.5, shows: [], value: 1.4e7, fccHeat: 0, episodes: 1 }; return { out: '✔ OMNI TV on air at 50% reach.' };
        case 'bank': P(s).bank = { name: 'God Trust', charter: Date.now(), deposits: 5e8, reserve: 5e8 * 0.5, lent: 0, loanBook: [], rate: 5, underwrite: 'balanced', equity: 5e8 * 0.2, runRisk: 0.02, failed: false, depositors: 333 }; return { out: '✔ God Trust chartered with $500M deposits.' };
        default: return { out: '⚠ spawn: rack | fiber | network | bank' };
      }
    }
    case 'wipe':
      return { out: '✔ TICKET CREATED: the world will be rebooted.', action: 'wipe' };
    case 'whoami':
      return { out: ` GOD ✔ ${s.email} — Server Admin privileges confirmed.` };
    default:
      return { out: `⚠ unknown command "${cmd}". Try help.` };
  }
}
