---
id: viewer-board
title: The spectator board renders from the log
milestone: 05-replay-viewer
depends_on: [viewer-skeleton, viewer-golden-fixture]
---

`src/board.ts` turns a log's `map` plus one board (`start.cells`, or `turns[n].after.cells`
for turn `n`) into one view-model per hex — label, terrain, owner, troops, garrison,
cut-off, and the pixel centre — and `src/render-board.ts` draws them into the frame. Nothing
is generated or recomputed: labels, coordinates and terrain come from `map`, and `cells[i]`
describes `map[i]`, which `matchLogSchema` already enforces.

Geometry is the mock-ups' (`salient/docs/salient-mockups.md`, "Build notes"): pointy-top hexes
of size 37 px, centre of `(q, r)` at `x = 64.09 × (q + r / 2)` and `y = 55.5 × r` from the
board centre, each hex drawn 60 × 69 px which leaves the 4 px gap. Copy the `.hx`, `.a`,
`.b`, `.n`, `.x`, `.bc`, `.bs`, `.nd`, `.ct`, `.hl` and `.ar` classes and the colour list
(`#2c6fd1` A with white text, `#e06f35` B with `#14110f`, neutral `#2a323d`, background
`#12161c`, panels `#1a2028`) out of `salient/docs/mockups/spectator-view.html` rather than
inventing them. The six symbols are the mock-ups' key: a number is the troop count and no
number means none, a Base is a number in a circle, a Node is a number in a diamond (grey when
neutral, and the number is its garrison), a blocked hex is the dark hatch, an owned hex cut
off from its Base is the team-coloured hatch, and every hex carries its small label at the
top.

DOM tests need a DOM: add `happy-dom` as a devDependency of the viewer and opt the render
tests in with a `// @vitest-environment happy-dom` docblock at the top of those files, so the
rest of the suite stays in the node environment `vitest.config.ts` sets. Keep `board.ts`
pure and test the numbers there; test the DOM only for what the DOM decides (which class a
hex gets, how many hexes carry each mark).

## Acceptance
- [ ] Turn 11 of golden-01 renders all 91 hexes with the owner colour, troop count and label
      the log gives, and the 7 Nodes and 2 Bases carry their symbols
- [ ] Exactly five hexes render the cut-off hatch at turn 11, and they are F1, G1, H1, H2
      and G3
- [ ] A blocked hex renders the blocked hatch and never an owner colour or a troop count
      anywhere in the match

## Verification
```bash
pnpm test -- viewer
pnpm --filter @no-dice/salient-viewer build
```
