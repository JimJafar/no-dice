# Series report: marvin/subagent vs bot:greedy

Series directory `/home/jim/code/no-dice/series/marvin-subagent-vs-greedy`.

5 pairs recorded, 10 matches: **10 counted**, **0 missing**.

Stopped on `max_pairs` — its full length.

## Result for marvin/subagent

| wins | losses | draws | matches | win rate | 95% Wilson interval |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 8 | 0 | 10 | 20.0% | 5.7% – 51.0% |

A draw counts as half a win.

The series never reached the interval test, so it recorded no stopping interval.

## Missing matches

No match failed or was voided: every match the series recorded is counted above.

## Margin

| matches | mean margin | bootstrap interval | resamples | confidence |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 18.5 | 10.5 – 26.8 | 2000 | 95.0% |

A knockout counts as 93 points.

## Knockouts

No match ended in a knockout.

## Per model

### marvin/subagent

10 matches counted — 5 in seat A, 5 in seat B.

|  | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns | 250 | 80 | 90 | 80 |
| turns passed | 2 | 2 | 0 | 0 |
| passed: no_submission | 2 | 2 | 0 | 0 |
| passed: timeout | 0 | 0 | 0 | 0 |
| passed: token_budget | 0 | 0 | 0 | 0 |
| passed: provider_error | 0 | 0 | 0 | 0 |
| passed: harness_crash | 0 | 0 | 0 | 0 |
| passed: tool_surface | 0 | 0 | 0 | 0 |
| wasted orders | 2 | 0 | 1 | 1 |
| wasted: no action points left | 0 | 0 | 0 | 0 |
| wasted: unknown hex | 0 | 0 | 0 | 0 |
| wasted: source hex not owned | 0 | 0 | 0 | 0 |
| wasted: destination is blocked | 0 | 0 | 0 | 0 |
| wasted: hexes are not adjacent | 1 | 0 | 0 | 1 |
| wasted: troop count must be a positive integer | 0 | 0 | 0 | 0 |
| wasted: not enough troops in source hex | 1 | 0 | 1 | 0 |
| rejected submissions | 25 | 6 | 10 | 9 |
| tool calls | 892 | 342 | 307 | 243 |
| tool errors | 43 | 31 | 8 | 4 |
| scouts | 75 | 51 | 21 | 3 |
| simulations | 193 | 70 | 68 | 55 |
| tokens | 59967929 | 9170210 | 25929009 | 24868710 |
| cost | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| tool calls per turn | 3.57 | 4.28 | 3.41 | 3.04 |
| scouts per turn | 0.30 | 0.64 | 0.23 | 0.04 |
| simulations per turn | 0.77 | 0.88 | 0.76 | 0.69 |
| tokens per turn | 239872 | 114628 | 288100 | 310859 |
| cost per turn | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| context mean tokens | 57440 | 26701 | 67490 | 76873 |
| context first / last | 11330 / 104765 | 11330 / 43975 | 72623 / 76839 | 39694 / 104765 |
| context max | 114038 | 62881 | 113786 | 114038 |
| compaction turns | 6 | 1 | 1 | 4 |

Compaction turns: seed 572152369, marvin/subagent in seat A, turn 18; seed 708123, marvin/subagent in seat A, turn 21; seed 479473028, marvin/subagent in seat A, turn 17; seed 479473028, marvin/subagent in seat B, turn 2; seed 479473028, marvin/subagent in seat B, turn 24; seed 313966722, marvin/subagent in seat B, turn 19.

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
| A | 1 | 4 | 0 | 5 | 20.0% | 3.6% – 62.4% |
| B | 1 | 4 | 0 | 5 | 20.0% | 3.6% – 62.4% |

The two rows are one pairing seen from each seat. A gap between them is the board, not the model, and it is why every pair is played twice.

