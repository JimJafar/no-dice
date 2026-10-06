# Series notes

The first real series: `marvin/subagent` against the Greedy bot, five seat-swapped
pairs, on Jim's Marvin server. This file records what was actually run — the
command, the ceiling, the concurrency, the wall time, the matches that went
missing and what a re-run of it would do — so a second pairing can be started,
and anyone tempted to replay this one knows what they would get, without either
having to be re-derived from the code.

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
(`packages/runner/src/series-stop.ts`) and this series was five. Read that record
with one caveat: its `state.pairs_played` is **3** even though all five planned
pairs were attempted, because a pair counts only once both its matches have a log
and two of them were voided (section 5); `matches_failed: 2` beside it is what
says so.

## 3. Concurrency 1, and what it did to the clock

`--concurrency` bounds **pairs**, and a pair's two matches are played together
(`pairRecordOf` in `packages/runner/src/series.ts`), so `--concurrency 1` still
puts two matches in flight — one Pi seat each — against one llama.cpp server.
That is what Jim asked for and it is what was done; it is also one reason the run
took longer than §7's 19-minutes-a-match estimate suggested. The main one is
at the end of this section.

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
18.8 minutes for a single match played alone. The prompt cache is part of where
that went: §7 measured 95.1% of a match's prompt tokens served from Marvin's cache,
and these matches ran at **14.2% to 80.4%** — two seats evicting each other's KV
cache on one server. §7's warning that the cache-missing turns are the slowest
turns of the match held here with a vengeance: the seat's slowest turn in seven
of the eight matches hit the runner's 300 s turn cap exactly, and 34 of its 200
turns were recorded as `timeout` passes.

The cache is the secondary cause, and it is worth saying what the main one was.
**The factory's own builder agent was sending requests to the same Marvin server
while the series ran**, and Marvin answers one request at a time. Every seat turn
therefore queued behind the builder agent's requests as well as behind the other
seat's, which is what pushed turns past the 300 s cap and — when Pi's own retries
ran out inside that queue — what produced the 18 `provider_error` passes of
section 4. The consequence for the figures: this series' per-turn times and pass
counts measure a **contended** server, not a seat playing alone, and §7's 18.8
minutes for a match played alone is the uncontended number. Nothing in the report
says which of its 53 passes were the builder's fault and which the seats'; the
series was not run alone, and that is what it cost.

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
submissions were rejected by the server. The 34 and the 18 are the contended
server of section 3 — the factory's builder agent on a Marvin that answers one
request at a time — before they are anything about the seat. Seven turns
compacted, with the largest
per-turn `context_tokens` in the logs 85,963 of the 131,072 window — which is not
the figure Pi compares against its 114,688 threshold: `context_tokens` is the
conversation sampled at the end of a turn, while Pi's threshold check runs
mid-turn over the pending tool results, so those seven turns are not evidence of
a threshold bypassed.

## 5. The matches that went missing: 2 of 10

Both were voided for `tool_surface`, which is exactly the failure §7 predicted
from the first Marvin attempt:

| seed | seat | turn | what the seat called |
| --- | --- | ---: | --- |
| 479473028 | A | 9 | `submit_orders` |
| 313966722 | B | 7 | `submit_orders` |

not `mcp__salient__submit_orders`, which is the name the harness gives it and the
name each of those seats had been using correctly — 7 and 5 times respectively —
before the slip. Pi answered `Tool submit_orders not found`, the harness saw a
tool name outside the seven, and `MatchVoided` left no log; the series recorded
the match as failed and the report keeps it out of the win rate under "Missing
matches". Two slips in the 516 tool calls the ten attempted matches made — 471
over the eight that were counted, 45 over the two that were not (24 and 21, the
bad call being the last of each) — but two of ten matches lost: at 150 matches
that is a lot of the series.

**Nothing was changed to fix this mid-series.** The prompt
(`games/salient/prompts/player-system.md`) does name the seven tools, but only by
their bare names — `get_rules`, `get_state`, scout, simulate, `read_notes`,
`write_notes`, `submit_orders` — and never gives the `mcp__salient__` prefix the
harness registers them under, which is the name a call has to carry to be inside
the seven. The rules and the harness are untouched either way, because a series
whose matches were played under two different prompts is not one series.

**The rule has since changed.** Commit `749d236` ("harness: a seat that calls one
of its seven tools by the bare name is refused, not voided") changed `PiPlayer`
in `packages/harness/src/pi-player.ts`: a call to one of the seven by its bare
name — `submit_orders` for `mcp__salient__submit_orders` — is now recorded as a
refused call and the turn goes on, because Pi answers that no such tool exists
and so nothing outside the game was reached; only a call to something outside the
seven still voids the match. These two matches would not be lost to it now. Hold that against the idea of simply repeating the run: a re-run plays
under a different harness rule, so it is **not a continuation of this series**,
and its `tool_surface` row is not comparable with the one above. Section 6 says
what a re-run actually does with the series gone.

## 6. What a re-run of that command would do: a new series

**There is nothing here to resume.** `series/marvin-subagent-vs-greedy/` —
`series.json`, `report.md` and the ten match logs — was written inside the
`series-real-run` task's own workspace, `/series/` in `.gitignore` is anchored to
the repository root and caught the whole directory (section 7), and it was
deleted when that task merged. Checked on this box:
`/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/` does not
exist. Only the two committed documents of section 7 survived.

So `planSeries` (`packages/runner/src/series-plan.ts`) has no `series.json` to
read: `seedBase` falls back to `options.seedBase ?? DEFAULT_SEED_BASE` — `0`, as
the original record said — and `drawSeeds` draws a fresh list from it. **Running
the command in section 1 again starts a new series** in a new
`series/marvin-subagent-vs-greedy/` directory: it plays all ten matches, not the
two that went missing, and the `series.json` and `report.md` it writes describe
that series alone. The 8 matches already played are not in it: they exist only
as the numbers in the kept report. The maps would be the same —
a fresh draw from base `0` at five pairs gives back exactly the five seeds
listed in section 1, which is what a fixed `seed_base` is for — but the record
would not be, and section 5 says the harness rule over a bare-name tool call has
changed since, so those ten matches are not the ten this one was.

The mechanics themselves are unchanged, and on a series that *is* on disk they
work as stated: a match whose `matches/<seed>-<seat-map>.json` exists is skipped;
`series.json` — written atomically once before anything is played and again after
every batch of `BATCH_PAIRS = 5` pairs — holds the pairing and the seed list, so
a resumed run continues from the seeds it already drew rather than drawing new
ones, and raising `--max-pairs` appends to that list instead of replacing it:

```bash
no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 10 --max-tokens 60000000 --concurrency 1
```

Lowering `--max-pairs` erases nothing either — a played match is never dropped
from the record. To reprint a finished series' report without playing anything:

```bash
no-dice stats --series series/marvin-subagent-vs-greedy
```

One caveat for a resumed run: the whole five-pair plan is one batch, so
`series.json` is rewritten at the end of it, not after each pair. The match logs
are written as each match finishes, so an interrupted run loses nothing — the
next run reads those logs back — but the record it leaves behind describes the
series as of the last completed batch.

**Keeping a series across tasks takes a deliberate step.** The logs are
gitignored on purpose — a real one is ~0.9–1.1 MB of tool results, section 7 — so
a series that has to outlive the task that played it has to be copied somewhere
tracked before that workspace goes. `series.json` and `report.md` are a few
kilobytes between them, and `series.json` alone is enough to put a later run back
on the same maps, though without the logs it replays the matches rather than
skipping them. Failing that, the series is replayed: the same command at the same
`--seed-base` deals the same maps, and its figures are comparable with an
earlier run's only while the harness rule and the prompt are the same (section 5
says they are not here, and section 3 says the machine was not either).

## 7. What the repository keeps

`series/` is gitignored and a real log is ~0.9–1.1 MB of tool results, so the
logs and the seat homes are not committed. What is kept is the report, copied
from `series/marvin-subagent-vs-greedy/report.md` into
`reports/series/marvin-subagent-vs-greedy.md`; it carries absolute paths from
the machine that played the series, which is what the generator writes, and those
paths name files that no longer exist. Two hand-written notes were added to
that copy afterwards — one under "Missing matches" saying what the `tool_surface`
voids were, one under the "Compaction turns:" line saying that a seed there
names a pair — and they are the only prose in it the generator did not write.

That kept copy predates one change to the generator, so a report regenerated from
now on differs from it in that line: `renderSeriesReportMarkdown` now names the
**match** each compaction turn came from — `seed 479473028, marvin/subagent in
seat B, turn 15`, the seat model X played in, which for that pair is seat B
because its seat-A match is the one `tool_surface` took (§5) — where the kept
copy prints `seed 479473028 turn 15` and the hand-written note under it says what
the seed cannot.
The turns themselves are unchanged, and the order is the record's, so the
line is the same one every time. The series directory is gone (§6), so nothing
here regenerates over the kept report: it stays as it was generated, and only a
fresh series — or `no-dice stats --series` on a series that is on disk — prints
the seat.

`.gitignore`'s series pattern is anchored to `/series/` for this to work at all:
unanchored, `series/` matched `reports/series/` too and the report could not be
tracked. The runner's own series directories are all at the repository root, so
anchoring costs nothing.
