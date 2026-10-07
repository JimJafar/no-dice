# Series report: deepseek/deepseek-flash vs bot:greedy

Series directory `/home/jim/code/no-dice/series/deepseek-flash-vs-greedy`.

5 pairs recorded, 10 matches: **10 counted**, **0 missing**.

Stopped on `max_pairs` — its full length.

## Result for deepseek/deepseek-flash

| wins | losses | draws | matches | win rate | 95% Wilson interval |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 3 | 0 | 10 | 70.0% | 39.7% – 89.2% |

A draw counts as half a win.

The series never reached the interval test, so it recorded no stopping interval.

## Missing matches

No match failed or was voided: every match the series recorded is counted above.

## Margin

| matches | mean margin | bootstrap interval | resamples | confidence |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 10.3 | 5.1 – 16.7 | 2000 | 95.0% |

A knockout counts as 93 points.

## Knockouts

No match ended in a knockout.

## Per model

### deepseek/deepseek-flash

10 matches counted — 5 in seat A, 5 in seat B.

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 250 | 80 | 90 | 80 |
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
| rejected submissions | 2 | 2 | 0 | 0 |
| tool calls | 1066 | 371 | 372 | 323 |
| tool errors | 87 | 44 | 19 | 24 |
| scouts | 36 | 28 | 7 | 1 |
| simulations | 238 | 75 | 88 | 75 |
| tokens | 147559555 | 19650153 | 55564310 | 72345092 |
| cost | $3.1540 | $0.9875 | $1.1779 | $0.9886 |
| tool calls per turn | 4.26 | 4.64 | 4.13 | 4.04 |
| scouts per turn | 0.14 | 0.35 | 0.08 | 0.01 |
| simulations per turn | 0.95 | 0.94 | 0.98 | 0.94 |
| tokens per turn | 590238 | 245627 | 617381 | 904314 |
| cost per turn | $0.0126 | $0.0123 | $0.0131 | $0.0124 |
| context mean tokens | 125461 | 51867 | 131504 | 192256 |
| context first / last | 30229 / 179842 | 30229 / 74896 | 98172 / 145078 | 173112 / 179842 |
| context max | 263048 | 99547 | 187056 | 263048 |
| compaction turns | 0 | 0 | 0 | 0 |

### bot:greedy

10 matches counted — 5 in seat A, 5 in seat B.

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 250 | 80 | 90 | 80 |
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
| tool calls | 510 | 170 | 180 | 160 |
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
| A | 4 | 1 | 0 | 5 | 80.0% | 37.6% – 96.4% |
| B | 3 | 2 | 0 | 5 | 60.0% | 23.1% – 88.2% |

The two rows are one pairing seen from each seat. A gap between them is the board, not the model, and it is why every pair is played twice.

