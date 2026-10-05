---
id: viewer-golden-acceptance
title: Golden log 01 at turn 11 renders the mock-up frame
milestone: 05-replay-viewer
depends_on: [viewer-turn-order, viewer-header, viewer-panels, viewer-headline, viewer-lead-chart, viewer-fog]
---

Brief §8's viewer test, end to end: load `games/salient/viewer/fixtures/golden-01-time-win.json`
through the same loader the browser uses, step to turn 11, and assert the frame the mock-up
draws. This is the milestone's done-means, so it asserts the frame as a whole rather than one
part of it, and it is the test that fails if a later change to the view-models quietly moves
a number.

Then `docs/viewer-notes.md`, beside `docs/pi-harness-notes.md`: how to run it
(`pnpm --filter @no-dice/salient-viewer dev`, and `?log=` for a log served by any static
server), where the fixtures come from (`scripts/golden-to-log.mjs`, and that their intent,
prediction and tool-trace lines are generated because the scripted prototype bots left none),
what is deliberately absent in v0 (the series line, the "Called it"/"Missed" verdict tag,
showcase selection which is milestone 06, live streaming and video export from brief §3), and
how the frame was compared against `salient/docs/mockups/spectator-view.png` by eye — say what
matched and what did not, since the mock-up's intent sentence is hand-written and the
fixture's is generated.

## Acceptance
- [ ] The turn-11 frame of golden-01 reads 43 and 33 with a 43 / 17 / 33 bar and a lead of 10,
      shows five cut-off hexes, the fight outline at F6 and twelve order arrows, the panels
      read 22 troops / 2 Nodes and 24 troops / 1 Node, and the lead chart marks turn 11 at +10
- [ ] The same turn under B's fog hides 27 playable hexes and keeps both Bases and all 7 Nodes
      visible
- [ ] `docs/viewer-notes.md` records how to run the viewer, where the fixtures come from and
      what v0 leaves out

## Verification
```bash
pnpm test -- viewer
pnpm --filter @no-dice/salient-viewer build
test -f docs/viewer-notes.md
```
