# Series report: marvin/subagent vs bot:greedy

Series directory `/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/marvin-subagent-vs-greedy`.

5 pairs recorded, 10 matches: **8 counted**, **2 missing**.

Stopped on `max_pairs` — its full length.

## Result for marvin/subagent

| wins | losses | draws | matches | win rate | 95% Wilson interval |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 8 | 0 | 8 | 0.0% | 0.0% – 32.4% |

A draw counts as half a win.

The series never reached the interval test, so it recorded no stopping interval.

## Missing matches

**2 of the series' 10 matches are not in the figures above.**

| reason | how | matches |
| --- | --- | ---: |
| tool_surface | failed | 2 |

- seed `479473028`, marvin/subagent in seat A, `/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/marvin-subagent-vs-greedy/matches/479473028-marvin-subagent-greedy.json` — failed: tool_surface
- seed `313966722`, marvin/subagent in seat B, `/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/marvin-subagent-vs-greedy/matches/313966722-greedy-marvin-subagent.json` — failed: tool_surface

## Margin

| matches | mean margin | bootstrap interval | resamples | confidence |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 33.9 | 27.3 – 41.5 | 2000 | 95.0% |

A knockout counts as 93 points.

## Knockouts

No match ended in a knockout.

## Per model

### marvin/subagent

8 matches counted — 4 in seat A, 4 in seat B.

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 200 | 64 | 72 | 64 |
| turns passed | 53 | 15 | 16 | 22 |
| passed: no_submission | 1 | 1 | 0 | 0 |
| passed: timeout | 34 | 12 | 12 | 10 |
| passed: token_budget | 0 | 0 | 0 | 0 |
| passed: provider_error | 18 | 2 | 4 | 12 |
| passed: harness_crash | 0 | 0 | 0 | 0 |
| passed: tool_surface | 0 | 0 | 0 | 0 |
| wasted orders | 1 | 1 | 0 | 0 |
| wasted: no action points left | 0 | 0 | 0 | 0 |
| wasted: unknown hex | 0 | 0 | 0 | 0 |
| wasted: source hex not owned | 0 | 0 | 0 | 0 |
| wasted: destination is blocked | 0 | 0 | 0 | 0 |
| wasted: hexes are not adjacent | 1 | 1 | 0 | 0 |
| wasted: troop count must be a positive integer | 0 | 0 | 0 | 0 |
| wasted: not enough troops in source hex | 0 | 0 | 0 | 0 |
| rejected submissions | 17 | 7 | 4 | 6 |
| tool calls | 471 | 195 | 173 | 103 |
| tool errors | 16 | 9 | 5 | 2 |
| scouts | 57 | 40 | 16 | 1 |
| simulations | 51 | 19 | 24 | 8 |
| tokens | 17379888 | 3077778 | 7227047 | 7075063 |
| cost | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| tool calls per turn | 2.35 | 3.05 | 2.40 | 1.61 |
| scouts per turn | 0.28 | 0.63 | 0.22 | 0.02 |
| simulations per turn | 0.26 | 0.30 | 0.33 | 0.13 |
| tokens per turn | 86899 | 48090 | 100376 | 110548 |
| cost per turn | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| context mean tokens | 39890 | 16800 | 43076 | 59398 |
| context first / last | 9400 / 73022 | 9400 / 20727 | 33711 / 54306 | 63929 / 73022 |
| context max | 85963 | 35488 | 60984 | 85963 |
| compaction turns | 7 | 0 | 5 | 2 |

Compaction turns: seed 572152369 turn 9, seed 708123 turn 13, seed 479473028 turn 15, seed 313966722 turn 15, seed 313966722 turn 20, seed 1003578858 turn 17, seed 1003578858 turn 21.

### bot:greedy

8 matches counted — 4 in seat A, 4 in seat B.

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 200 | 64 | 72 | 64 |
| turns passed | 0 | 0 | 0 | 0 |
| passed: no_submission | 0 | 0 | 0 | 0 |
| passed: timeout | 0 | 0 | 0 | 0 |
| passed: token_budget | 0 | 0 | 0 | 0 |
| passed: provider_error | 0 | 0 | 0 | 0 |
| passed: harness_crash | 0 | 0 | 0 | 0 |
| passed: tool_surface | 0 | 0 | 0 | 0 |
| wasted orders | 0 | 0 | 0 | 0 |
| wasted: no action points left | 0 | 0 | 0 | 0 |
| wasted: unknown hex | 0 | 0 | 0 | 0 |
| wasted: source hex not owned | 0 | 0 | 0 | 0 |
| wasted: destination is blocked | 0 | 0 | 0 | 0 |
| wasted: hexes are not adjacent | 0 | 0 | 0 | 0 |
| wasted: troop count must be a positive integer | 0 | 0 | 0 | 0 |
| wasted: not enough troops in source hex | 0 | 0 | 0 | 0 |
| rejected submissions | 0 | 0 | 0 | 0 |
| tool calls | 408 | 136 | 144 | 128 |
| tool errors | 0 | 0 | 0 | 0 |
| scouts | 0 | 0 | 0 | 0 |
| simulations | 0 | 0 | 0 | 0 |
| tokens | 0 | 0 | 0 | 0 |
| cost | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| tool calls per turn | 2.04 | 2.13 | 2.00 | 2.00 |
| scouts per turn | 0.00 | 0.00 | 0.00 | 0.00 |
| simulations per turn | 0.00 | 0.00 | 0.00 | 0.00 |
| tokens per turn | 0 | 0 | 0 | 0 |
| cost per turn | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| context mean tokens | 0 | 0 | 0 | 0 |
| context first / last | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| context max | 0 | 0 | 0 | 0 |
| compaction turns | 0 | 0 | 0 | 0 |

## Seat effect

| X's seat | wins | losses | draws | matches | win rate | 95% Wilson interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 0 | 4 | 0 | 4 | 0.0% | 0.0% – 49.0% |
| B | 0 | 4 | 0 | 4 | 0.0% | 0.0% – 49.0% |

The two rows are one pairing seen from each seat. A gap between them is the board, not the model, and it is why every pair is played twice.

