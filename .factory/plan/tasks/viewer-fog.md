---
id: viewer-fog
title: A seat's fog-of-war view
milestone: 05-replay-viewer
depends_on: [viewer-board]
---

A toggle that shows the board as one seat knows it: spectator by default, and either seat's
fog-of-war view on request, per `salient/docs/mockups/fog-of-war-view.html`.

Visibility is recomputed from the log, not imported from the engine — the viewer never
imports `@no-dice/salient-engine`, and the engine's `visibleHexes` is not reachable from it.
The rule is the rules' ("Visibility and scouting"): a seat sees the hexes it owns and every
hex next to them; the terrain of every hex is always known, so Base and Node positions are
never hidden, only their troop counts and garrisons. Adjacency comes from the `q`/`r` the
log's `map` carries, so it is six axial deltas over the map's own hex list. A hidden hex
renders its terrain and a `?` where a troop count would be; a visible hex renders exactly what
the cell says.

The frame at turn `n` shows what that seat knew when the board was `turns[n].after` — the
mock-up's frame is turn 11's board as Player B knows it at the start of turn 12. Fog changes
visibility only: the score bar, the panels and the chart keep showing the logged truth, which
is what makes the toggle a comparison rather than a second source of facts.

## Acceptance
- [ ] At turn 11 of golden-01 the B fog view hides 27 playable hexes, and every hidden hex
      shows its terrain and a `?` instead of a troop count
- [ ] Both Bases and all 7 Nodes stay visible under fog for both seats
- [ ] The spectator frame and either fog frame at the same turn differ in visibility only:
      same hexes, same labels, same scores

## Verification
```bash
pnpm test -- viewer
```
