# Rules evidence: bot:greedy vs bot:greedy

Series directory `/home/jim/.software-factory/workspaces/no-dice/the-engine-s-minimum-force-attack-on-a-n/series/greedy-vs-greedy`.

Every figure here is counted out of the match logs alone — no engine, no replay — and is what `docs/rules-review.md` writes from. Compaction turns and context size are not repeated: they are in `report.md` beside this file.

10 pairs recorded, 20 matches: **20 counted**, **0 missing**.

## Per match

The lead changes, largest swing and final lead change columns are brief §6.7's excitement score, which is also how the showcase match is ranked.

| seed | X's seat | turns | lead changes | largest swing | final lead change | hex flips | flips/turn 18-25 | Node hand changes | Node ping-pong | neutral captures |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 572152369 | A | 25 | 0 | 0 (turn 1) | none | 70 | 0.00 | 2 | — | 70 |
| 572152369 | B | 25 | 0 | 0 (turn 1) | none | 70 | 0.00 | 2 | — | 70 |
| 708123 | A | 25 | 0 | 0 (turn 1) | none | 74 | 0.00 | 2 | — | 72 |
| 708123 | B | 25 | 0 | 0 (turn 1) | none | 74 | 0.00 | 2 | — | 72 |
| 479473028 | A | 25 | 0 | 0 (turn 1) | none | 88 | 1.00 | 4 | — | 74 |
| 479473028 | B | 25 | 0 | 0 (turn 1) | none | 88 | 1.00 | 4 | — | 74 |
| 313966722 | A | 25 | 0 | 0 (turn 1) | none | 94 | 1.25 | 6 | — | 76 |
| 313966722 | B | 25 | 0 | 0 (turn 1) | none | 94 | 1.25 | 6 | — | 76 |
| 1003578858 | A | 25 | 0 | 0 (turn 1) | none | 90 | 0.75 | 6 | — | 76 |
| 1003578858 | B | 25 | 0 | 0 (turn 1) | none | 90 | 0.75 | 6 | — | 76 |
| 1170483992 | A | 25 | 0 | 0 (turn 1) | none | 104 | 2.50 | 6 | — | 76 |
| 1170483992 | B | 25 | 0 | 0 (turn 1) | none | 104 | 2.50 | 6 | — | 76 |
| 1321242287 | A | 25 | 0 | 0 (turn 1) | none | 96 | 1.50 | 4 | — | 74 |
| 1321242287 | B | 25 | 0 | 0 (turn 1) | none | 96 | 1.50 | 4 | — | 74 |
| 1393685491 | A | 25 | 0 | 0 (turn 1) | none | 98 | 1.25 | 6 | — | 76 |
| 1393685491 | B | 25 | 0 | 0 (turn 1) | none | 98 | 1.25 | 6 | — | 76 |
| 979268032 | A | 25 | 0 | 0 (turn 1) | none | 90 | 1.25 | 6 | — | 76 |
| 979268032 | B | 25 | 0 | 0 (turn 1) | none | 90 | 1.25 | 6 | — | 76 |
| 1248158229 | A | 25 | 0 | 0 (turn 1) | none | 92 | 1.75 | 6 | — | 76 |
| 1248158229 | B | 25 | 0 | 0 (turn 1) | none | 92 | 1.75 | 6 | — | 76 |

## Over the series

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 500 | 160 | 180 | 160 |
| hex flips | 1792 | 1344 | 268 | 180 |
| hex flips per turn | 3.58 | 8.40 | 1.49 | 1.13 |
| captures of neutral hexes | 1492 | 1344 | 124 | 24 |
| captures of neutral hexes per turn | 2.98 | 8.40 | 0.69 | 0.15 |
| Node hand changes | 96 | 52 | 24 | 20 |
| Node hand changes per turn | 0.19 | 0.33 | 0.13 | 0.13 |

## Per match, on average

| matches | lead changes | matches that changed the lead | hex flips | Node hand changes | neutral captures | re-scouts, both seats |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 0.00 | 0 of 20 | 89.60 | 4.80 | 74.60 | 0.00 |

| largest single-turn swing, mean | largest single-turn swing, highest match | turn of the final lead change | hex flips per turn | neutral captures per turn | Node hand changes per turn |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00 | 0 | — | 3.58 | 2.98 | 0.19 |

The turn of the final lead change is averaged over the matches whose lead changed at all; a match that never changed it contributes nothing rather than a nought.

## Against the rules' bot figures

| question | bots without the home bonus | bots with it | this series |
| --- | --- | --- | ---: |
| hexes flipped a turn late on (turns 18-25) | 6.5 | 1 to 2.4 | 1.13 |
| lead changes a match | 3.2 | 1.4 | 0.00 |

The rules' figures are bot matches; this series' are whatever its pairing played. The comparison is the point of the row, not a pass or a fail.

## Node ping-pong

No counted match had a Node change owner on three or more turns with at least two of them consecutive.

## Re-scouts

A scout of a hex that seat had already scouted in the match. A seat that re-scouts the same hexes over and over is paying action points for memory the engine could hand it.

| player | matches | scouts | re-scouts | distinct hexes | re-scouts per match |
| --- | ---: | ---: | ---: | ---: | ---: |
| bot:greedy | 40 | 0 | 0 | 0 | 0.00 |

## Missing matches

No match failed or was voided: every match the series recorded is counted above.
