---
id: engine-board
title: The engine generates the board
milestone: 01-engine
depends_on: [scaffold-workspace]
---

In `games/salient/engine/src`, implement the board: axial coordinates `(q,r)` with
`|q| <= 5`, `|r| <= 5`, `|q+r| <= 5` (91 hexes), the label `String.fromCharCode(65+q+5) +
(r+6)` so A6 is `(-5,0)`, F6 is `(0,0)` and the Bases are B6 `(-4,0)` and J6 `(4,0)`, the
six neighbour directions `(q+1,r) (q+1,r-1) (q,r-1) (q-1,r) (q-1,r+1) (q,r+1)`, distance
`(|dq| + |dr| + |dq+dr|) / 2`, and `generateMap(seed, config)` ported from `genMap` and
`mulberry32` in `salient/docs/reference/engine.js` so the same seed gives the same map as
the prototype: 6 blocked pairs and 3 Nodes per half chosen by the seeded generator and
mirrored by `(q,r) -> (-q,-r)`, the centre Node at `(0,0)`, one home Node exactly 2 from the
Base and two more at distance 3-5 that are at least 3 apart and at least 2 from the centre,
maps rejected unless all passable hexes are connected, up to 500 attempts. Export the
`Config` constants from the rules: 25 turns, 6 action points, 5 starting troops, Base +2,
Node +1, Node garrison 3, home bonus 1, points plain 1 / base 1 / node 3. No I/O, no
`Math.random`, no floating point. Whole-number integer arithmetic only.

## Acceptance
- [ ] A generated map has 91 hexes, 12 blocked, 7 Nodes, two Bases with 5 troops each, and
      is unchanged by the half-turn rotation `(q,r) -> (-q,-r)` with seats swapped
- [ ] The same seed gives an identical map, and every passable hex is reachable from B6
- [ ] A symmetry check over 300 consecutive seeds finds every map rotationally symmetric
      and connected

## Verification
```bash
pnpm test -- board
```
