'use strict';
const E = require('./engine.js');

function bfsStep(H, from, isGoal, canPass) {
  const prev = new Map([[from, null]]); const queue = [from];
  while (queue.length) {
    const k = queue.shift();
    if (k !== from && isGoal(k)) { let c = k; while (prev.get(c) !== from) c = prev.get(c); return { step: c, goal: k }; }
    for (const n of E.neighbours(k, H)) if (!prev.has(n) && H[n].t !== 'blocked' && (!canPass || canPass(n))) { prev.set(n, k); queue.push(n); }
  }
  return null;
}

function makeRandomBot(seed) {
  const rnd = E.mulberry32(seed);
  return function (view, p, cfg) {
    const H = view.hexes; const orders = []; const avail = {};
    const own = Object.keys(H).filter(k => H[k].visible && H[k].owner === p && H[k].troops > 0);
    for (const k of own) avail[k] = H[k].troops;
    for (let i = 0; i < cfg.AP && own.length; i++) {
      const s = own[rnd() % own.length]; if (!avail[s]) continue;
      const ns = E.neighbours(s, H).filter(n => H[n].t !== 'blocked'); if (!ns.length) continue;
      const n = 1 + rnd() % avail[s]; avail[s] -= n;
      orders.push({ from: s, to: ns[rnd() % ns.length], n });
    }
    return { orders, intent: 'Random legal moves.', prediction: 'None.' };
  };
}

function makeBot(params) {
  const mem = {};
  return function (view, p, cfg) {
    const H = view.hexes; const foe = p === 'A' ? 'B' : 'A'; const id = k => H[k].id;
    for (const k in H) if (H[k].visible) mem[k] = { owner: H[k].owner, troops: H[k].troops, garrison: H[k].garrison };
    const known = k => H[k].visible ? H[k] : (mem[k] || { owner: null, troops: 0, garrison: H[k].t === 'node' ? cfg.NODE_GARRISON : 0 });
    const myBase = view.base[p], foeBase = view.base[foe];
    const avail = {}; const stacks = [];
    for (const k in H) if (H[k].visible && H[k].owner === p && H[k].troops > 0) { avail[k] = H[k].troops; stacks.push(k); }
    stacks.sort();
    // threats the bot can see
    const threats = [];
    for (const k in H) if (H[k].visible && H[k].owner === foe && H[k].troops > 0) threats.push(k);
    let near = 0; for (const k of threats) if (E.hexDist(E.parse(k), E.parse(myBase)) <= 2) near += H[k].troops;
    const guard = Math.max(params.guard, near > 0 ? near + 1 : 0);
    if (avail[myBase] !== undefined) avail[myBase] = Math.max(0, H[myBase].troops - guard);
    // hold own nodes that have an enemy stack next to them
    for (const k of stacks) if (H[k].t === 'node') {
      let adj = 0; for (const n of E.neighbours(k, H)) if (H[n].owner === foe) adj += H[n].troops;
      if (adj > 0) avail[k] = Math.max(0, H[k].troops - Math.min(H[k].troops, adj + 1));
    }
    const cands = [];
    for (const s of stacks) {
      if (!avail[s]) continue;
      let frontier = false;
      for (const d of E.neighbours(s, H)) {
        const h = H[d]; if (h.t === 'blocked' || h.owner === p) continue;
        frontier = true;
        if (h.owner === null) {
          cands.push({ from: s, to: d, n: h.garrison + 1, value: h.t === 'node' ? params.wNode : params.wPlain, kind: h.t === 'node' ? 'node' : 'claim' });
        } else {
          const need = h.troops + 1 + cfg.HOME + (h.troops > 0 ? params.margin : 0);
          const v = h.t === 'base' ? 1000 : h.t === 'node' ? params.wFoeNode : params.wFoePlain;
          cands.push({ from: s, to: d, n: need, value: v - h.troops, kind: 'attack', all: h.t === 'base' });
        }
      }
      if (avail[s] >= params.strike) {
        const path = bfsStep(H, s, k => k === foeBase);
        if (path && H[path.step].owner === p) cands.push({ from: s, to: path.step, n: 0, all: true, value: params.wStrike, kind: 'strike', goal: path.goal });
      }
      if (!frontier) {
        const path = bfsStep(H, s, k => known(k).owner !== p);
        if (path) cands.push({ from: s, to: path.step, n: 0, all: true, value: params.wMarch + Math.min(avail[s], 9), kind: 'march', goal: path.goal });
      }
    }
    cands.sort((a, b) => b.value - a.value || (a.from + a.to < b.from + b.to ? -1 : 1));
    const orders = []; const done = []; const claimed = new Set(); const moved = new Set(); let ap = cfg.AP;
    for (const c of cands) {
      if (ap <= 0) break;
      if ((c.kind === 'claim' || c.kind === 'node') && claimed.has(c.to)) continue;
      if ((c.kind === 'march' || c.kind === 'strike') && moved.has(c.from)) continue;
      const n = c.all ? avail[c.from] : c.n;
      if (n < 1 || n < c.n || avail[c.from] < n) continue;
      orders.push({ from: c.from, to: c.to, n }); done.push({ ...c, n });
      avail[c.from] -= n; ap--; claimed.add(c.to); if (c.all) moved.add(c.from);
    }
    // placeholder intent and prediction text, built from the chosen orders
    const parts = [];
    const nodes = done.filter(c => c.kind === 'node'), atk = done.filter(c => c.kind === 'attack'), claims = done.filter(c => c.kind === 'claim');
    const strikes = done.filter(c => c.kind === 'strike'), marches = done.filter(c => c.kind === 'march');
    for (const c of nodes) parts.push(`Take the node at ${id(c.to)} with ${c.n}.`);
    for (const c of atk) parts.push(`Attack ${id(c.to)} from ${id(c.from)} with ${c.n}${H[c.to].t === 'base' ? ' to end it' : H[c.to].t === 'node' ? ' to take their node' : ''}.`);
    for (const c of strikes) parts.push(`Push ${c.n} from ${id(c.from)} toward their base.`);
    if (claims.length) parts.push(`Claim ${claims.length} open hex${claims.length > 1 ? 'es' : ''}.`);
    if (marches.length) parts.push(`Bring ${marches.reduce((s, c) => s + c.n, 0)} troops up to the front.`);
    if (guard > params.guard) parts.push(`Hold ${guard} at base against the stack nearby.`);
    if (!parts.length) parts.push('Hold position.');
    let prediction;
    if (threats.length) {
      threats.sort((a, b) => H[b].troops - H[a].troops || (a < b ? -1 : 1));
      const t = threats[0]; let tgt = null, best = -1;
      for (const n of E.neighbours(t, H)) if (H[n].owner === p) { const v = (H[n].t === 'base' ? 100 : H[n].t === 'node' ? 10 : 1) - H[n].troops / 100; if (v > best) { best = v; tgt = n; } }
      prediction = tgt ? `Their ${H[t].troops} at ${id(t)} will hit ${id(tgt)}.` : `Their ${H[t].troops} at ${id(t)} will keep advancing.`;
    } else prediction = 'No contact yet. They are still expanding.';
    return { orders, intent: parts.slice(0, 3).join(' '), prediction };
  };
}

const STYLES = {
  expander: { guard: 0, margin: 0, wNode: 30, wPlain: 14, wFoeNode: 26, wFoePlain: 12, wMarch: 4, strike: 99, wStrike: 0 },
  striker: { guard: 2, margin: 1, wNode: 34, wPlain: 10, wFoeNode: 40, wFoePlain: 16, wMarch: 6, strike: 7, wStrike: 22 },
  raider: { guard: 1, margin: 0, wNode: 32, wPlain: 12, wFoeNode: 44, wFoePlain: 18, wMarch: 8, strike: 9, wStrike: 20 },
};

module.exports = { makeBot, makeRandomBot, STYLES };
