'use strict';
const E = require('./engine.js');
const B = require('./bots.js');

// Each player sees the board in its own frame: its base is always on the same side.
const flip = k => { const [q, r] = E.parse(k); return E.K(-q, -r); };
function viewFor(state, p) {
  const vis = E.visible(state, p); const hexes = {}; const f = p === 'B' ? flip : (k => k);
  for (const k in state.hexes) {
    const h = state.hexes[k]; const v = vis.has(k); const [q, r] = E.parse(f(k));
    hexes[f(k)] = v ? { ...h, q, r, visible: true } : { q, r, id: h.id, t: h.t, visible: false };
  }
  return { turn: state.turn, hexes, base: { A: f(state.base.A), B: f(state.base.B) } };
}
const unflip = (orders, p) => p === 'B' ? orders.map(o => ({ from: flip(o.from), to: flip(o.to), n: o.n })) : orders;

function snapshot(state, cfg, order) {
  const sA = E.score(state, 'A', cfg), sB = E.score(state, 'B', cfg);
  return {
    cells: order.map(k => { const h = state.hexes[k]; return [h.owner === 'A' ? 1 : h.owner === 'B' ? 2 : 0, h.troops, h.garrison, h.owner && !(h.owner === 'A' ? sA : sB).supplied.has(k) ? 1 : 0]; }),
    score: { A: sA.pts, B: sB.pts },
    troops: { A: order.reduce((s, k) => s + (state.hexes[k].owner === 'A' ? state.hexes[k].troops : 0), 0), B: order.reduce((s, k) => s + (state.hexes[k].owner === 'B' ? state.hexes[k].troops : 0), 0) },
  };
}

function play(seed, botA, botB, cfg, keepLog) {
  const state = E.genMap(seed, cfg); const order = Object.keys(state.hexes);
  const log = keepLog ? { ruleset: 'salient-v0', seed, cfg, map: order.map(k => { const h = state.hexes[k]; return { k, id: h.id, q: h.q, r: h.r, t: h.t }; }), base: state.base, start: snapshot(state, cfg, order), turns: [] } : null;
  const margins = []; let wasted = { A: 0, B: 0 };
  while (!state.over) {
    const a = botA(viewFor(state, 'A'), 'A', cfg), b = botB(viewFor(state, 'B'), 'B', cfg);
    b.orders = unflip(b.orders, 'B');
    const n = state.turn;
    const res = E.resolve(state, { A: a.orders, B: b.orders }, null, cfg);
    wasted.A += res.wasted.A.length; wasted.B += res.wasted.B.length;
    margins.push(res.score.A - res.score.B);
    if (keepLog) log.turns.push({ n, orders: { A: a.orders, B: b.orders }, intent: { A: a.intent, B: b.intent }, prediction: { A: a.prediction, B: b.prediction }, events: res.events, wasted: res.wasted, after: snapshot(state, cfg, order) });
  }
  let leadChanges = 0, last = 0;
  for (const m of margins) { const s = Math.sign(m); if (s !== 0 && last !== 0 && s !== last) leadChanges++; if (s !== 0) last = s; }
  let sA = E.score(state, 'A', cfg).pts, sB = E.score(state, 'B', cfg).pts;
  // A knockout is recorded as every point on the board to nil, whatever the score at that moment.
  if (state.result.type === 'knockout') {
    let total = 0; for (const k in state.hexes) if (state.hexes[k].t !== 'blocked') total += cfg.PTS[state.hexes[k].t];
    sA = state.result.winner === 'A' ? total : 0; sB = state.result.winner === 'B' ? total : 0;
  }
  if (keepLog) log.result = { ...state.result, score: { A: sA, B: sB }, margin: sA - sB };
  return { result: state.result, score: { A: sA, B: sB }, margins, leadChanges, wasted, log };
}

module.exports = { play, viewFor };

if (require.main === module) {
  const cfg = { ...E.DEFAULT_CFG };
  for (const arg of process.argv.slice(2)) { const [k, v] = arg.split('='); if (k in cfg) cfg[k] = k === 'SUPPLY' ? v === 'true' : Number(v); }
  const N = 300;
  const pairings = [
    ['expander', 'striker'], ['striker', 'expander'], ['striker', 'striker'], ['expander', 'expander'], ['striker', 'random'], ['expander', 'random'],
  ];
  for (const [na, nb] of pairings) {
    let wA = 0, wB = 0, dr = 0, ko = 0, len = 0, lc = 0, marg = 0, absM = 0, sa = 0, sb = 0, waste = 0;
    for (let seed = 1; seed <= N; seed++) {
      const mk = (n, s) => n === 'random' ? B.makeRandomBot(s) : B.makeBot(B.STYLES[n]);
      const r = play(seed, mk(na, seed * 7 + 1), mk(nb, seed * 7 + 2), cfg, false);
      if (r.result.winner === 'A') wA++; else if (r.result.winner === 'B') wB++; else dr++;
      if (r.result.type === 'knockout') ko++;
      len += r.result.turn; lc += r.leadChanges; marg += r.score.A - r.score.B; absM += Math.abs(r.score.A - r.score.B); sa += r.score.A; sb += r.score.B; waste += r.wasted.A + r.wasted.B;
    }
    console.log(`${na.padEnd(9)} vs ${nb.padEnd(9)} | A wins ${(100 * wA / N).toFixed(0)}% B wins ${(100 * wB / N).toFixed(0)}% draws ${(100 * dr / N).toFixed(0)}% | knockouts ${(100 * ko / N).toFixed(0)}% | avg length ${(len / N).toFixed(1)} | avg score ${(sa / N).toFixed(1)}-${(sb / N).toFixed(1)} | avg |margin| ${(absM / N).toFixed(1)} | lead changes ${(lc / N).toFixed(2)} | wasted ${waste}`);
  }
}
