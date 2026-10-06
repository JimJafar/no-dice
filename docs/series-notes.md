# Series notes

The first real series: `marvin/subagent` against the Greedy bot, five seat-swapped
pairs, on Jim's Marvin server. This file records what was actually run — the
command, the ceiling, the concurrency, the wall time, the matches that went
missing and how to resume it — so the series can be continued, and a second
pairing can be started, without anyone re-deriving either from the code.

The figures themselves are in the report:
[`reports/series/marvin-subagent-vs-greedy.md`](../reports/series/marvin-subagent-vs-greedy.md).
Related: [the pi harness notes, §7](pi-harness-notes.md), which is where the
per-match cost estimate this run was budgeted against came from.

---

## 1. The command

```bash
no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 5 --max-tokens 60000000 --concurrency 1
```

Run from the repository root as `pnpm exec no-dice series …` after `pnpm install`
(`node packages/runner/src/cli.ts series …` is the same command). It wrote
`series/marvin-subagent-vs-greedy/`: `series.json`, `report.md`, and one
`salient-log/1` per played match under `matches/`.

What the seat was played at is not in the command line, so it is recorded here:

| | |
| --- | --- |
| Provider | `marvin`, from the committed `providers.json` — `apiKeyEnv: null`, so Pi's credential check is answered by `"apiKey": "none"` and Marvin checks no key |
| Model | `subagent`, an alias of `Strata-IQ3S` on the llama.cpp/llama-swap server |
| Pi | `@earendil-works/pi-coding-agent` 1.0.2, pinned by `packages/harness/package.json`, in RPC mode, one child process per seat |
| Thinking | `medium` — the runner's `DEFAULT_THINKING` in `packages/runner/src/match.ts`, recorded in each log's `players` header |
| Window / output cap | `contextWindow: 131072`, `maxTokens: 8192`, both decisions in `providers.json` because the endpoint advertises neither |
| Seeds | `seed_base: 0`, drawn as 572152369, 708123, 479473028, 313966722, 1003578858 |

A second pairing is the same command with a different `--name` and `--a`; the
pairing is stored in the series' own `series.json`, so two pairings never share a
directory.

## 2. The ceiling: 60,000,000 tokens, and no money ceiling

`--max-tokens 60000000` is the guard, not `--max-cost`. Every turn of every match
of this series records `cost_usd: 0`, because Marvin is Jim's own hardware and
`providers.json` prices each of its four token rates at 0 — a money ceiling would
never have fired on it. Tokens and wall time are the price
([§7](pi-harness-notes.md) says this at length).

The series spent **17,379,888 tokens** over its 8 played matches — 10,264,946
input, 355,375 output, 6,759,567 cache-read, 0 cache-write — which is 29% of the
ceiling. The ceiling is there to stop a runaway, not to end the run, and it did
not end the run: `series.json` records `stop_reason: "max_pairs"` with
`stopped_early: false`, which is the pair limit being reached, i.e. the series
playing the length it was asked for. The adaptive stop could not have fired at
this length either: the Wilson interval test starts at `MIN_TEST_PAIRS = 10` pairs
(`packages/runner/src/series-stop.ts`) and this series was five.

## 3. Concurrency 1, and what it did to the clock

`--concurrency` bounds **pairs**, and a pair's two matches are played together
(`pairRecordOf` in `packages/runner/src/series.ts`), so `--concurrency 1` still
puts two matches in flight — one Pi seat each — against one llama.cpp server.
That is what Jim asked for and it is what was done; it is also the main reason
the run took longer than §7's 19-minutes-a-match estimate suggested.

Wall time, start to finish: **5 h 27 m 44 s**, 2026-10-06 00:10:53Z to 05:38:37Z.

| pair | seed | pair finished | minutes |
| --- | ---: | --- | ---: |
| 1 | 572152369 | 01:14:24 | 63.5 |
| 2 | 708123 | 02:29:14 | 74.8 |
| 3 | 479473028 | 03:25:37 | 56.4 |
| 4 | 313966722 | 04:28:18 | 62.7 |
| 5 | 1003578858 | 05:38:37 | 70.3 |

Pairs 3 and 4 are the short ones because each lost a match part-way (section 5).

Per played match, the Pi seat's own turn time came to 56–75 minutes against §7's
18.8 minutes for a single match played alone. The prompt cache is where that
went: §7 measured 95.1% of a match's prompt tokens served from Marvin's cache,
and these matches ran at **14.2% to 80.4%** — two seats evicting each other's KV
cache on one server. §7's warning that the cache-missing turns are the slowest
turns of the match held here with a vengeance: the seat's slowest turn in seven
of the eight matches hit the runner's 300 s turn cap exactly, and 34 of its 200
turns were recorded as `timeout` passes.

## 4. What the series says

`marvin/subagent` lost every match it played: **0 wins, 8 losses, 0 draws**, a
win rate of **0.0% with a 95% Wilson interval of 0.0% – 32.4%** over 8 matches.
All eight went the distance — `time` at turn 25, no knockouts — and Greedy's mean
margin was 33.9 points (bootstrap 27.3 – 41.5). The seat effect is nil: 0–4 in
seat A and 0–4 in seat B, which is what playing every pair twice is for.

The report's per-model table says how the model seat lost them, and it is worth
reading before anyone concludes the model was outplayed: of its 200 turns, **53
ended as passes** — 34 `timeout` (the 300 s cap above), 18 `provider_error` (a Pi
agent loop that failed after Pi's own retries), 1 `no_submission` — and 17
submissions were rejected by the server. Seven turns compacted, with context
peaking at 85,963 tokens of the 131,072 window, so compaction fired below the
114,688 threshold §7 worked out for this window.

## 5. The matches that went missing: 2 of 10

Both were voided for `tool_surface`, which is exactly the failure §7 predicted
from the first Marvin attempt:

| seed | seat | turn | what the seat called |
| --- | --- | ---: | --- |
| 479473028 | A | 9 | `submit_orders` |
| 313966722 | B | 7 | `submit_orders` |

not `mcp__salient__submit_orders`, which is the name the harness gives it and the
name each of those seats had been using correctly — 15 and 11 times respectively —
before the slip. Pi answered `Tool submit_orders not found`, the harness saw a
tool name outside the seven, and `MatchVoided` left no log; the series recorded
the match as failed and the report keeps it out of the win rate under "Missing
matches". Two slips in the 530 tool calls the ten attempted matches made — 471
over the eight that were counted, 59 over the two that were not — but two of ten
matches lost: at 150 matches that is a lot of the series.

**Nothing was changed to fix this mid-series.** The prompt
(`games/salient/prompts/player-system.md`) still never names the seven tools, and
the rules and the harness are untouched, because a series whose matches were
played under two different prompts is not one series. The two voided matches have
no log on disk, so the next run of the same command plays them again — that is
the honest way to find out whether they were bad luck.

## 6. Resuming it, and extending it

The rule is a log on disk: `planSeries` (`packages/runner/src/series-plan.ts`)
skips every match whose `matches/<seed>-<seat-map>.json` already exists, and
`series.json` — written atomically once before anything is played and again after
every batch of `BATCH_PAIRS = 5` pairs — holds the pairing and the seed list, so
a resumed run continues from the seeds it already drew rather than drawing new
ones.

So: **run the command in section 1 again.** It will play only the two voided
matches, reprint the standing lines, and rewrite `report.md`. To make the series
longer, raise the limit and change nothing else:

```bash
no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 10 --max-tokens 60000000 --concurrency 1
```

That continues the same series: the five pairs already on disk are kept and
counted, and five more seeds are drawn from the recorded `seed_base`. Lowering
`--max-pairs` does not erase anything either — a played match is never dropped
from the record. To reprint a finished series' report without playing anything:

```bash
no-dice stats --series series/marvin-subagent-vs-greedy
```

One caveat for a resumed run: the whole five-pair plan is one batch, so
`series.json` is rewritten at the end of it, not after each pair. The match logs
are written as each match finishes, so an interrupted run loses nothing — the
next run reads those logs back — but the record it leaves behind describes the
series as of the last completed batch.

## 7. What the repository keeps

`series/` is gitignored and a real log is ~0.9–1.1 MB of tool results, so the
logs and the seat homes are not committed. What is kept is the report, copied
verbatim from `series/marvin-subagent-vs-greedy/report.md` into
`reports/series/marvin-subagent-vs-greedy.md`; it carries absolute paths from
the machine that played the series, which is what the generator writes.

`.gitignore`'s series pattern is anchored to `/series/` for this to work at all:
unanchored, `series/` matched `reports/series/` too and the report could not be
tracked. The runner's own series directories are all at the repository root, so
anchoring costs nothing.
