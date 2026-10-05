---
id: viewer-lead-chart
title: The match gets a lead-by-turn chart
milestone: 05-replay-viewer
depends_on: [viewer-skeleton, viewer-golden-fixture]
---

`src/chart.ts`: the lead by turn from `turns[n].after.score` for turns 1 to the frame's turn,
A's bar above the line and B's below, the current turn marked with its margin written over it,
and the axis labelled to `config.turns` so a match that ends early — golden-03 stops at turn 19
— still shows the whole axis with the unplayed turns blank, exactly as the mock-up draws it.
The chart is a view of the logged scores only: the margin is `score.A - score.B` per turn, and
the result's own `margin` is not used here, because the chart is about the shape of the match
rather than how it ended.

## Acceptance
- [ ] The chart has one bar per played turn, on A's side for turns 1-9 and 11 and on B's side
      for turn 10 (39-41), with turn 11 marked `+10`
- [ ] Turns beyond the last played one are drawn as empty slots up to `config.turns`
- [ ] The marked turn follows the frame: scrubbing to turn 4 moves the mark and its number

## Verification
```bash
pnpm test -- viewer
```
