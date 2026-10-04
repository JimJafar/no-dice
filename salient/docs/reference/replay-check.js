'use strict';
// Replays a golden log through the engine and checks every board and score.
// Usage: node replay-check.js ../golden/*.json
const fs = require('fs');
const E = require('./engine.js');

function check(file) {
  const log = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...E.DEFAULT_CFG, TURNS: log.cfg.turns, AP: log.cfg.ap, R: log.cfg.radius };
  const key = {}; const hexes = {};
  log.map.forEach((h, i) => {
    const k = E.K(h.q, h.r); key[h.id] = k; const c = log.start.cells[i];
    hexes[k] = { q: h.q, r: h.r, id: h.id, t: h.t, owner: c[0] === 1 ? 'A' : c[0] === 2 ? 'B' : null, troops: c[1], garrison: c[2] };
  });
  const state = { turn: 1, hexes, base: { A: key[log.base.A], B: key[log.base.B] }, over: false, result: null };
  const toOrders = list => list.map(([from, to, n]) => ({ from: key[from], to: key[to], n }));
  for (const t of log.turns) {
    const res = E.resolve(state, { A: toOrders(t.orders.A), B: toOrders(t.orders.B) }, null, cfg);
    log.map.forEach((h, i) => {
      const s = state.hexes[key[h.id]], c = t.after.cells[i];
      const owner = s.owner === 'A' ? 1 : s.owner === 'B' ? 2 : 0;
      if (owner !== c[0] || s.troops !== c[1] || s.garrison !== c[2]) throw new Error(`${file}: turn ${t.n} hex ${h.id} is ${owner}/${s.troops}/${s.garrison}, log says ${c[0]}/${c[1]}/${c[2]}`);
    });
    if (res.score.A !== t.after.score.A || res.score.B !== t.after.score.B) throw new Error(`${file}: turn ${t.n} score mismatch`);
  }
  if (!state.over || state.result.type !== log.result.type || state.result.winner !== log.result.winner) throw new Error(`${file}: result mismatch`);
  return `${file}: ok, ${log.turns.length} turns, ${log.result.type}, winner ${log.result.winner || 'none'}, ${log.result.score.A} to ${log.result.score.B}`;
}

for (const f of process.argv.slice(2)) console.log(check(f));
