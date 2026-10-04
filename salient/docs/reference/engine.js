'use strict';
// Salient v0 engine: deterministic, integer-only resolution.

const DEFAULT_CFG = {
  R: 5, TURNS: 25, AP: 6,
  START_TROOPS: 5, BASE_PROD: 2, NODE_PROD: 1,
  NODE_GARRISON: 3, BLOCKED_PAIRS: 6, HOME: 1,
  PTS: { plain: 1, node: 3, base: 1 },
  SUPPLY: true,
};
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const K = (q, r) => q + ',' + r;
const parse = k => k.split(',').map(Number);
const hexDist = (a, b) => { const dq = a[0] - b[0], dr = a[1] - b[1]; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
const label = (q, r, R) => String.fromCharCode(65 + q + R) + (r + R + 1);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return (t ^ t >>> 14) >>> 0;
  };
}

function neighbours(k, hexes) {
  const [q, r] = parse(k); const out = [];
  for (const [dq, dr] of DIRS) { const nk = K(q + dq, r + dr); if (hexes[nk]) out.push(nk); }
  return out;
}

function genMap(seed, cfg) {
  const R = cfg.R; const rnd = mulberry32(seed); const ri = n => rnd() % n;
  const cells = [];
  for (let r = -R; r <= R; r++) for (let q = -R; q <= R; q++) if (Math.abs(q + r) <= R) cells.push([q, r]);
  const baseA = [-(R - 1), 0], baseB = [R - 1, 0];
  const mirror = c => [-c[0], -c[1]];
  const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let attempt = 0; attempt < 500; attempt++) {
    const t = {}; for (const c of cells) t[K(...c)] = 'plain';
    t[K(...baseA)] = 'base'; t[K(...baseB)] = 'base';
    const canon = cells.filter(c => (c[0] < 0 || (c[0] === 0 && c[1] < 0)) && hexDist(c, baseA) > 1 && hexDist(c, baseB) > 1);
    for (const c of shuffle(canon).slice(0, cfg.BLOCKED_PAIRS)) { t[K(...c)] = 'blocked'; t[K(...mirror(c))] = 'blocked'; }
    t[K(0, 0)] = 'node';
    const mine = cells.filter(c => t[K(...c)] === 'plain' && hexDist(c, baseA) < hexDist(c, baseB));
    const home = shuffle(mine.filter(c => hexDist(c, baseA) === 2))[0];
    if (!home) continue;
    const picked = [home];
    for (const c of shuffle(mine.filter(c => hexDist(c, baseA) >= 3 && hexDist(c, baseA) <= 5))) {
      if (picked.length >= 3) break;
      if (picked.every(p => hexDist(p, c) >= 3) && hexDist(c, [0, 0]) >= 2) picked.push(c);
    }
    if (picked.length < 3) continue;
    for (const c of picked) { t[K(...c)] = 'node'; t[K(...mirror(c))] = 'node'; }
    // connectivity over passable hexes
    const pass = cells.filter(c => t[K(...c)] !== 'blocked').map(c => K(...c));
    const seen = new Set([K(...baseA)]); const queue = [K(...baseA)];
    const fake = {}; for (const k of pass) fake[k] = 1;
    while (queue.length) { const k = queue.shift(); for (const n of neighbours(k, fake)) if (!seen.has(n)) { seen.add(n); queue.push(n); } }
    if (seen.size !== pass.length) continue;
    const hexes = {};
    for (const c of cells) {
      const k = K(...c); const tt = t[k];
      hexes[k] = { q: c[0], r: c[1], id: label(c[0], c[1], R), t: tt, owner: null, troops: 0, garrison: tt === 'node' ? cfg.NODE_GARRISON : 0 };
    }
    hexes[K(...baseA)].owner = 'A'; hexes[K(...baseA)].troops = cfg.START_TROOPS;
    hexes[K(...baseB)].owner = 'B'; hexes[K(...baseB)].troops = cfg.START_TROOPS;
    return { turn: 1, hexes, base: { A: K(...baseA), B: K(...baseB) }, over: false, result: null, seed };
  }
  throw new Error('map generation failed for seed ' + seed);
}

function score(state, p, cfg) {
  const H = state.hexes; const b = state.base[p];
  if (H[b].owner !== p) return { pts: 0, supplied: new Set(), owned: 0 };
  let pts = 0; const seen = new Set([b]); const queue = [b];
  while (queue.length) {
    const k = queue.shift(); pts += cfg.PTS[H[k].t];
    for (const n of neighbours(k, H)) if (!seen.has(n) && H[n].owner === p) { seen.add(n); queue.push(n); }
  }
  let owned = 0, all = 0;
  for (const k in H) if (H[k].owner === p) { owned++; all += cfg.PTS[H[k].t]; }
  if (!cfg.SUPPLY) pts = all;
  return { pts, supplied: seen, owned };
}

function visible(state, p) {
  const H = state.hexes; const vis = new Set();
  for (const k in H) if (H[k].owner === p) { vis.add(k); for (const n of neighbours(k, H)) vis.add(n); }
  return vis;
}

// orders: { A: [{from,to,n}], B: [...] }, scouts: { A: n, B: n } (action points already spent on scouting)
function resolve(state, orders, scouts, cfg) {
  const H = state.hexes; const ev = []; const wasted = { A: [], B: [] };
  const moves = { A: new Map(), B: new Map() }; const spent = { A: {}, B: {} };
  for (const p of ['A', 'B']) {
    let ap = cfg.AP - ((scouts && scouts[p]) || 0);
    for (const o of orders[p] || []) {
      if (ap <= 0) { wasted[p].push({ o, why: 'no action points left' }); continue; }
      ap--;
      const h = H[o.from], d = H[o.to]; let why = null;
      if (!h || !d) why = 'unknown hex';
      else if (h.owner !== p) why = 'source hex not owned';
      else if (d.t === 'blocked') why = 'destination is blocked';
      else if (!neighbours(o.from, H).includes(o.to)) why = 'hexes are not adjacent';
      else if (!Number.isInteger(o.n) || o.n < 1) why = 'troop count must be a positive integer';
      else if ((spent[p][o.from] || 0) + o.n > h.troops) why = 'not enough troops in source hex';
      if (why) { wasted[p].push({ o, why }); continue; }
      spent[p][o.from] = (spent[p][o.from] || 0) + o.n;
      const mk = o.from + '>' + o.to; moves[p].set(mk, (moves[p].get(mk) || 0) + o.n);
    }
  }
  // edge clashes
  for (const [mk, a] of moves.A) {
    const [from, to] = mk.split('>'); const rk = to + '>' + from; const b = moves.B.get(rk) || 0;
    if (a > 0 && b > 0) { const m = Math.min(a, b); moves.A.set(mk, a - m); moves.B.set(rk, b - m); ev.push({ type: 'clash', between: [from, to], A: a, B: b }); }
  }
  const arr = { A: {}, B: {} };
  for (const p of ['A', 'B']) for (const [mk, n] of moves[p]) { const to = mk.split('>')[1]; arr[p][to] = (arr[p][to] || 0) + n; }
  for (const k in H) {
    const h = H[k]; if (h.t === 'blocked') continue;
    let a = (h.owner === 'A' ? h.troops - (spent.A[k] || 0) : 0) + (arr.A[k] || 0);
    let b = (h.owner === 'B' ? h.troops - (spent.B[k] || 0) : 0) + (arr.B[k] || 0);
    // The owner of a hex defends with a home bonus that absorbs its first losses.
    const own = h.owner, ha = own === 'A' ? cfg.HOME : 0, hb = own === 'B' ? cfg.HOME : 0;
    if ((a > 0 && b > 0) || (own === 'A' && b > 0) || (own === 'B' && a > 0)) {
      const ea = a + ha, eb = b + hb, L = Math.min(ea, eb);
      if (a > 0 && b > 0) ev.push({ type: 'battle', at: k, A: a, B: b, owner: own });
      else if (ea === eb || (own === 'A' ? ea > eb : eb > ea)) ev.push({ type: 'repelled', at: k, by: own === 'A' ? 'B' : 'A', n: a + b });
      const na = ea > eb ? a - Math.max(0, L - ha) : 0, nb = eb > ea ? b - Math.max(0, L - hb) : 0;
      a = na; b = nb;
    }
    let s = a > 0 ? 'A' : b > 0 ? 'B' : null; let n = a + b;
    if (s && h.owner === null && h.garrison > 0) {
      if (n > h.garrison) { n -= h.garrison; h.garrison = 0; }
      else { ev.push({ type: 'repelled', at: k, by: s, n }); h.garrison -= n; n = 0; s = null; }
    }
    if (s && n > 0) {
      if (h.owner !== s) ev.push({ type: 'capture', at: k, by: s, from: h.owner, terrain: h.t });
      h.owner = s; h.troops = n;
    } else if (h.owner) h.troops = 0;
  }
  const lostA = H[state.base.A].owner !== 'A', lostB = H[state.base.B].owner !== 'B';
  if (lostA || lostB) {
    state.over = true;
    state.result = { type: 'knockout', winner: lostA && lostB ? null : lostA ? 'B' : 'A', turn: state.turn };
  } else {
    for (const k in H) { const h = H[k]; if (!h.owner) continue; if (h.t === 'base') h.troops += cfg.BASE_PROD; else if (h.t === 'node') h.troops += cfg.NODE_PROD; }
  }
  const sc = { A: score(state, 'A', cfg).pts, B: score(state, 'B', cfg).pts };
  if (!state.over && state.turn >= cfg.TURNS) {
    state.over = true;
    state.result = { type: 'time', winner: sc.A > sc.B ? 'A' : sc.B > sc.A ? 'B' : null, turn: state.turn };
  }
  state.turn++;
  return { events: ev, wasted, score: sc };
}

module.exports = { DEFAULT_CFG, DIRS, K, parse, hexDist, label, genMap, neighbours, score, visible, resolve, mulberry32 };
