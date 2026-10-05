---
id: viewer-turn-order
title: Turns step, scrub and autoplay with the orders animating in order
milestone: 05-replay-viewer
depends_on: [viewer-board]
---

`src/turns.ts` owns the frame index: 0 is the start position (`start.cells` and
`start.score`), then 1 to `log.turns.length`, and step-back, step-forward, a scrub slider and
autoplay. The last frame is the last logged turn, which for a knockout is the knockout turn,
not `config.turns`.

Within a turn the frame animates in the order brief §6.8 asks for: the board as it stood after
the previous turn, then each seat's orders appear as arrows in the order the log lists them
(A's `orders` then B's, each `from` → `to` looked up by label in `map`, drawn with the
mock-up's `.ar` class), then the hexes of that turn's `battle` and `clash` events flash a
white outline (`.hl` behind the hex), then the board settles to `turns[n].after`. A `clash`
names an edge (`between` two labels) rather than a hex, so its outline goes on both hexes it
crosses.

The settled frame is the contract: a paused or scrubbed frame shows exactly what the log
says, and the animation is presentation only, driven by a timer the tests can step, never by
wall-clock `setTimeout` in the view-model. A turn whose seat passed shows no arrows for that
seat.

## Acceptance
- [ ] Stepping and scrubbing land on the logged after-state of the selected turn, frame 0 is
      `start`, and the last frame is the last logged turn
- [ ] At turn 11 of golden-01 the twelve submitted orders (six per seat) render as arrows at
      the log's `from` and `to` labels, and F6 carries the fight outline
- [ ] With a scripted timer, the arrows appear before the fight outline, and autoplay advances
      and stops on the last turn

## Verification
```bash
pnpm test -- viewer
```
