---
id: viewer-header
title: The header shows both scores, the score bar and the lead
milestone: 05-replay-viewer
depends_on: [viewer-skeleton, viewer-golden-fixture]
---

The header row of the mock-up: each seat's name, its score in the big numerals, the turn
counter, the score bar and the line under it. Names come from the log's `players` — a `pi`
seat shows `model`, a `bot` seat shows `bot` — and both scores from `turns[n].after.score`,
with the start score at frame 0. The turn counter is `TURN n OF N` from the frame index and
`config.turns`.

The score bar is A's points from the left, B's from the right, and the points nobody is
scoring in the middle, with the tick at half of the total, exactly as the mock-up draws it.
The total is not the constant 93: it is the map's playable hexes valued by `config.points`
(plain 1, Base 1, Node 3), which for golden-01's 79 playable hexes and 7 Nodes is 93, and
which a smaller or differently seeded map changes. The middle segment is that total minus
both scores, which is what supply costs a player. The line under the bar states the lead
("A leads by 10") and how many of the total are not scoring.

The series line the mock-up shows stays a placeholder: a log carries no series, and showcase
selection is milestone 06. Say so in the element rather than leaving an unexplained gap.

## Acceptance
- [ ] At turn 11 of golden-01 the header reads 43 and 33, the bar's three segments are 43 /
      17 / 33, and the line says A leads by 10 and that 17 of the 93 points are not scoring
- [ ] The counter reads `TURN 11 OF 25`, and the two names come from the log's `players`
      (a bot seat names its bot)
- [ ] The 93 is computed from `map` and `config.points`: a log on a different map yields a
      different total, and the three segments still add up to it

## Verification
```bash
pnpm test -- viewer
```
