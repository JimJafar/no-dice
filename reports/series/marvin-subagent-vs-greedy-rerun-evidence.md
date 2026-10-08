# Rules evidence: marvin/subagent vs bot:greedy

Series directory `/home/jim/code/no-dice/series/marvin-subagent-vs-greedy`.

Every figure here is counted out of the match logs alone — no engine, no replay — and is what `docs/rules-review.md` writes from. Compaction turns and context size are not repeated: they are in `report.md` beside this file.

5 pairs recorded, 10 matches: **10 counted**, **0 missing**.

## Per match

The lead changes, largest swing and final lead change columns are brief §6.7's excitement score, which is also how the showcase match is ranked.

| seed | X's seat | turns | lead changes | largest swing | final lead change | hex flips | flips/turn 18-25 | Node hand changes | Node ping-pong | neutral captures |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 572152369 | A | 25 | 0 | 7 (turn 9) | none | 111 | 2.25 | 8 | — | 76 |
| 572152369 | B | 25 | 0 | 8 (turn 16) | none | 109 | 2.75 | 11 | — | 77 |
| 708123 | A | 25 | 0 | 6 (turn 4) | none | 108 | 2.88 | 5 | — | 74 |
| 708123 | B | 25 | 1 | 6 (turn 13) | 25 | 97 | 2.25 | 7 | — | 76 |
| 479473028 | A | 25 | 1 | 6 (turn 4) | 16 | 97 | 1.25 | 6 | — | 76 |
| 479473028 | B | 25 | 4 | 9 (turn 25) | 25 | 101 | 2.25 | 7 | — | 76 |
| 313966722 | A | 25 | 0 | 9 (turn 16) | none | 99 | 1.88 | 10 | E5 | 77 |
| 313966722 | B | 25 | 0 | 10 (turn 11) | none | 103 | 2.38 | 7 | — | 77 |
| 1003578858 | A | 25 | 0 | 7 (turn 14) | none | 117 | 3.63 | 7 | — | 76 |
| 1003578858 | B | 25 | 0 | 7 (turn 19) | none | 109 | 2.38 | 8 | — | 77 |

## Over the series

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 250 | 80 | 90 | 80 |
| hex flips | 1051 | 603 | 257 | 191 |
| hex flips per turn | 4.20 | 7.54 | 2.86 | 2.39 |
| captures of neutral hexes | 762 | 603 | 152 | 7 |
| captures of neutral hexes per turn | 3.05 | 7.54 | 1.69 | 0.09 |
| Node hand changes | 76 | 37 | 29 | 10 |
| Node hand changes per turn | 0.30 | 0.46 | 0.32 | 0.13 |

## Per match, on average

| matches | lead changes | matches that changed the lead | hex flips | Node hand changes | neutral captures | re-scouts, both seats |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0.60 | 3 of 10 | 105.10 | 7.60 | 76.20 | 1.70 |

| largest single-turn swing, mean | largest single-turn swing, highest match | turn of the final lead change | hex flips per turn | neutral captures per turn | Node hand changes per turn |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7.50 | 10 | 22.0 | 4.20 | 3.05 | 0.30 |

The turn of the final lead change is averaged over the matches whose lead changed at all; a match that never changed it contributes nothing rather than a nought.

## Against the rules' bot figures

| question | bots without the home bonus | bots with it | this series |
| --- | --- | --- | ---: |
| hexes flipped a turn late on (turns 18-25) | 6.5 | 1 to 2.4 | 2.39 |
| lead changes a match | 3.2 | 1.4 | 0.60 |

The rules' figures are bot matches; this series' are whatever its pairing played. The comparison is the point of the row, not a pass or a fail.

## Node ping-pong

**1 of 10 counted matches** had a Node change owner on three or more turns with at least two of them consecutive.

- seed `313966722`, hex `E5`, turns 5, 19, 20

## Re-scouts

A scout of a hex that seat had already scouted in the match. A seat that re-scouts the same hexes over and over is paying action points for memory the engine could hand it.

| player | matches | scouts | re-scouts | distinct hexes | re-scouts per match |
| --- | ---: | ---: | ---: | ---: | ---: |
| bot:greedy | 10 | 0 | 0 | 0 | 0.00 |
| marvin/subagent | 10 | 75 | 17 | 58 | 1.70 |

## Missing matches

No match failed or was voided: every match the series recorded is counted above.
