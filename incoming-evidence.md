# Rules evidence: deepseek/deepseek-flash vs bot:greedy

Series directory `/home/jim/code/no-dice/series/deepseek-flash-vs-greedy`.

Every figure here is counted out of the match logs alone — no engine, no replay — and is what `docs/rules-review.md` writes from. Compaction turns and context size are not repeated: they are in `report.md` beside this file.

5 pairs recorded, 10 matches: **10 counted**, **0 missing**.

## Per match

The lead changes, largest swing and final lead change columns are brief §6.7's excitement score, which is also how the showcase match is ranked.

| seed | X's seat | turns | lead changes | largest swing | final lead change | hex flips | flips/turn 18-25 | Node hand changes | Node ping-pong | neutral captures |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 572152369 | A | 25 | 4 | 8 (turn 25) | 11 | 97 | 2.38 | 8 | — | 76 |
| 572152369 | B | 25 | 1 | 10 (turn 18) | 20 | 108 | 2.38 | 9 | H6 | 77 |
| 708123 | A | 25 | 1 | 6 (turn 19) | 23 | 99 | 3.00 | 5 | — | 75 |
| 708123 | B | 25 | 0 | 4 (turn 4) | none | 103 | 2.63 | 6 | — | 74 |
| 479473028 | A | 25 | 0 | 4 (turn 4) | none | 107 | 2.63 | 7 | — | 77 |
| 479473028 | B | 25 | 1 | 8 (turn 15) | 15 | 95 | 1.50 | 9 | — | 77 |
| 313966722 | A | 25 | 1 | 8 (turn 18) | 24 | 109 | 2.63 | 9 | F6 | 77 |
| 313966722 | B | 25 | 1 | 12 (turn 25) | 25 | 129 | 4.50 | 12 | F6 | 77 |
| 1003578858 | A | 25 | 1 | 6 (turn 25) | 10 | 92 | 1.25 | 6 | — | 76 |
| 1003578858 | B | 25 | 0 | 6 (turn 18) | none | 92 | 1.25 | 6 | — | 76 |

## Over the series

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 250 | 80 | 90 | 80 |
| hex flips | 1031 | 635 | 203 | 193 |
| hex flips per turn | 4.12 | 7.94 | 2.26 | 2.41 |
| captures of neutral hexes | 762 | 635 | 119 | 8 |
| captures of neutral hexes per turn | 3.05 | 7.94 | 1.32 | 0.10 |
| Node hand changes | 77 | 34 | 29 | 14 |
| Node hand changes per turn | 0.31 | 0.42 | 0.32 | 0.17 |

## Per match, on average

| matches | lead changes | matches that changed the lead | hex flips | Node hand changes | neutral captures | re-scouts, both seats |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1.00 | 7 of 10 | 103.10 | 7.70 | 76.20 | 0.80 |

| largest single-turn swing, mean | largest single-turn swing, highest match | turn of the final lead change | hex flips per turn | neutral captures per turn | Node hand changes per turn |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7.20 | 12 | 18.3 | 4.12 | 3.05 | 0.31 |

The turn of the final lead change is averaged over the matches whose lead changed at all; a match that never changed it contributes nothing rather than a nought.

## Against the rules' bot figures

| question | bots without the home bonus | bots with it | this series |
| --- | --- | --- | ---: |
| hexes flipped a turn late on (turns 18-25) | 6.5 | 1 to 2.4 | 2.41 |
| lead changes a match | 3.2 | 1.4 | 1.00 |

The rules' figures are bot matches; this series' are whatever its pairing played. The comparison is the point of the row, not a pass or a fail.

## Node ping-pong

**3 of 10 counted matches** had a Node change owner on three or more turns with at least two of them consecutive.

- seed `572152369`, hex `H6`, turns 4, 17, 18
- seed `313966722`, hex `F6`, turns 8, 18, 19
- seed `313966722`, hex `F6`, turns 11, 12, 21, 22, 24, 25

## Re-scouts

A scout of a hex that seat had already scouted in the match. A seat that re-scouts the same hexes over and over is paying action points for memory the engine could hand it.

| player | matches | scouts | re-scouts | distinct hexes | re-scouts per match |
| --- | ---: | ---: | ---: | ---: | ---: |
| bot:greedy | 10 | 0 | 0 | 0 | 0.00 |
| deepseek/deepseek-flash | 10 | 36 | 8 | 28 | 0.80 |

## Missing matches

No match failed or was voided: every match the series recorded is counted above.
