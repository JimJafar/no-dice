---
id: engine-visibility-scoring
title: The engine knows what a player sees and what it scores
milestone: 01-engine
depends_on: [engine-board]
---

Add `visibleHexes(state, seat)` and `score(state, seat, config)` to the engine, porting
`visible` and `score` from `salient/docs/reference/engine.js`. Visibility is the player's
own hexes plus every hex next to them; terrain of every hex is always known, so Bases and
Nodes are never hidden. Scoring is a flood fill from the player's Base over hexes that
player owns: a plain hex or Base is 1 point, a Node 3, 93 points on the board in total, and
a region cut from the Base scores nothing while still producing troops. Return the supplied
set so the log and the viewer can mark cut-off hexes, and return 0 for a player that no
longer owns its Base. Follow the suggested API in brief §6.1: `score` returns
`{ points, supplied }`. Iterate hexes in one fixed order (row, then column) so results never
depend on object key order.

## Acceptance
- [ ] A hex owned but unreachable from its Base through the owner's hexes scores nothing,
      and scores again once reconnected
- [ ] `visibleHexes` returns exactly the owned hexes and their neighbours, and includes the
      garrison of neutral Nodes inside it
- [ ] Full-board scores add up to 93 when one player owns everything

## Verification
```bash
pnpm test -- supply
```
