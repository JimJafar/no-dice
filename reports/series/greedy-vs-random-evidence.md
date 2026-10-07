# Rules evidence: bot:greedy vs bot:random

Series directory `/home/jim/.software-factory/workspaces/no-dice/a-finished-series-keeps-its-rules-eviden/series/greedy-vs-random`.

Every figure here is counted out of the match logs alone — no engine, no replay — and is what `docs/rules-review.md` writes from. Compaction turns and context size are not repeated: they are in `report.md` beside this file.

5 pairs recorded, 10 matches: **10 counted**, **0 missing**.

## Per match

The lead changes, largest swing and final lead change columns are brief §6.7's excitement score, which is also how the showcase match is ranked.

| seed | X's seat | turns | lead changes | largest swing | final lead change | hex flips | flips/turn 18-25 | Node hand changes | Node ping-pong | neutral captures |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 572152369 | A | 22 | 0 | 15 (turn 22) | none | 88 | 2.40 | 6 | — | 75 |
| 572152369 | B | 22 | 0 | 11 (turn 22) | none | 82 | 1.20 | 7 | — | 75 |
| 708123 | A | 18 | 0 | 16 (turn 18) | none | 78 | 1.00 | 4 | — | 74 |
| 708123 | B | 19 | 0 | 12 (turn 19) | none | 77 | 1.00 | 4 | — | 73 |
| 479473028 | A | 25 | 0 | 9 (turn 20) | none | 92 | 1.25 | 7 | — | 77 |
| 479473028 | B | 25 | 0 | 11 (turn 24) | none | 96 | 2.00 | 8 | — | 77 |
| 313966722 | A | 25 | 0 | 9 (turn 14) | none | 93 | 2.00 | 6 | — | 76 |
| 313966722 | B | 25 | 0 | 10 (turn 22) | none | 91 | 1.63 | 8 | — | 76 |
| 1003578858 | A | 25 | 0 | 9 (turn 25) | none | 94 | 1.63 | 8 | H6 | 76 |
| 1003578858 | B | 21 | 0 | 17 (turn 21) | none | 84 | 1.50 | 6 | — | 76 |

## Over the series

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 227 | 80 | 90 | 57 |
| hex flips | 875 | 497 | 283 | 95 |
| hex flips per turn | 3.85 | 6.21 | 3.14 | 1.67 |
| captures of neutral hexes | 755 | 497 | 246 | 12 |
| captures of neutral hexes per turn | 3.33 | 6.21 | 2.73 | 0.21 |
| Node hand changes | 64 | 15 | 36 | 13 |
| Node hand changes per turn | 0.28 | 0.19 | 0.40 | 0.23 |

## Per match, on average

| matches | lead changes | matches that changed the lead | hex flips | Node hand changes | neutral captures | re-scouts, both seats |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0.00 | 0 of 10 | 87.50 | 6.40 | 75.50 | 0.00 |

| largest single-turn swing, mean | largest single-turn swing, highest match | turn of the final lead change | hex flips per turn | neutral captures per turn | Node hand changes per turn |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 11.90 | 17 | — | 3.85 | 3.33 | 0.28 |

The turn of the final lead change is averaged over the matches whose lead changed at all; a match that never changed it contributes nothing rather than a nought.

## Against the rules' bot figures

| question | bots without the home bonus | bots with it | this series |
| --- | --- | --- | ---: |
| hexes flipped a turn late on (turns 18-25) | 6.5 | 1 to 2.4 | 1.67 |
| lead changes a match | 3.2 | 1.4 | 0.00 |

The rules' figures are bot matches; this series' are whatever its pairing played. The comparison is the point of the row, not a pass or a fail.

## Node ping-pong

**1 of 10 counted matches** had a Node change owner on three or more turns with at least two of them consecutive.

- seed `1003578858`, hex `H6`, turns 14, 21, 22

## Re-scouts

A scout of a hex that seat had already scouted in the match. A seat that re-scouts the same hexes over and over is paying action points for memory the engine could hand it.

| player | matches | scouts | re-scouts | distinct hexes | re-scouts per match |
| --- | ---: | ---: | ---: | ---: | ---: |
| bot:greedy | 10 | 0 | 0 | 0 | 0.00 |
| bot:random | 10 | 0 | 0 | 0 | 0.00 |

## Missing matches

No match failed or was voided: every match the series recorded is counted above.
