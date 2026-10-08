# Series notes

The first real series: `marvin/subagent` against the Greedy bot, five seat-swapped
pairs, on Jim's Marvin server. This file records what was actually run — the
command, the ceiling, the concurrency, the wall time, the matches that went
missing and what a re-run of it would do — so a second pairing can be started,
and anyone tempted to replay this one knows what they would get, without either
having to be re-derived from the code.

Sections 1 to 7 are that run — **run 1**, and every figure in them is run 1's. Section 8 records
the **rerun** of the same pairing, played on 2026-10-07: a second series on the same five maps, a
second sample, and not a continuation of run 1's record.

The figures themselves are in the reports:
[`reports/series/marvin-subagent-vs-greedy.md`](../reports/series/marvin-subagent-vs-greedy.md) for
run 1, and
[`reports/series/marvin-subagent-vs-greedy-rerun.md`](../reports/series/marvin-subagent-vs-greedy-rerun.md)
with
[`…-rerun-evidence.md`](../reports/series/marvin-subagent-vs-greedy-rerun-evidence.md) for the
rerun. Related: [the pi harness notes, §7](pi-harness-notes.md), which is where the
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
tracked before that workspace goes. `series.json`, `report.md` and `evidence.md`
are a few kilobytes between them (§7 gives the two copy steps), and
`series.json` alone is enough to put a later run back on the same maps, though
without the logs it replays the matches rather than skipping them. Failing that, the series is replayed: the same command at the same
`--seed-base` deals the same maps, and its figures are comparable with an
earlier run's only while the harness rule and the prompt are the same (section 5
says they are not here, and section 3 says the machine was not either).

## 7. What the repository keeps

`series/` is gitignored and a real log is ~0.9–1.1 MB of tool results, so the
logs and the seat homes are not committed. What is kept is the report and the
rules evidence, each copied by hand out of the series directory. The report went
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

**The evidence file has to be copied the same way, and for run 1 it was not.**
`no-dice evidence --series series/<name>` counts the five figures the rules' open
questions are stated in — lead changes, hex flips per turn with the mean over
turns 18-25, Node hand changes and whether any Node ping-ponged, captures of
hexes that were neutral at the start of the turn, and each seat's re-scouts —
over the same `series.json` and the same counted matches `stats` reports, and
writes them to `series/<name>/evidence.md`: inside the gitignored directory, so
it goes with the workspace exactly as the logs do. Run 1's report was copied and
its evidence was not, and that — not the sample size — is why four of
[`docs/rules-review.md`](rules-review.md)'s eight sections say `Left open`. So a
finished series, and every resumed or extended run of one, ends with two copies
rather than one:

```bash
no-dice stats    --series series/marvin-subagent-vs-greedy  # rewrites report.md
no-dice evidence --series series/marvin-subagent-vs-greedy  # writes evidence.md
cp series/marvin-subagent-vs-greedy/report.md    reports/series/marvin-subagent-vs-greedy.md
cp series/marvin-subagent-vs-greedy/evidence.md reports/series/marvin-subagent-vs-greedy-evidence.md
```

Both copies are verbatim, and both name absolute paths on the machine that played
the series, which is what the two generators write; the kept report has always
carried them. The evidence copy is the only place these counters live: the logs
they were counted out of are gitignored, so once the workspace is gone
`no-dice evidence` cannot be run over them again.

`reports/series/greedy-vs-random-evidence.md` is a kept copy of a five-pair
`bot:greedy` against `bot:random` series played on this box — 5 pairs, 10
matches, 10 counted, 0 missing — kept for one reason: so that the step above has
been done at least once, and there is a kept file to point at, while the real
series is played again (§6). Its figures are bot figures, and the file prints
them against the rules' own bot figures: **1.67** hexes flipped a turn over
turns 18-25 against the rules' 1 to 2.4 with the home bonus, and **0.00** lead
changes a match against their 1.4 — Greedy is ahead from the opening in every
one of those ten, so there is no lead to change. Only the evidence half of that
series is kept: its win-rate report says nothing anyone needs, and the counters
are the half that went missing last time.

`reports/series/greedy-vs-greedy-evidence.md` is a kept copy of a second bot series,
played for `docs/rules-review.md`'s Centre Node ping-pong section: 10 pairs, 20 matches, 20
counted, 0 missing. When it was first run `no-dice series` could not play it: `planSeries`
refused a pairing whose two seats fold to one slug — a mirrored pairing has no seat map that tells
its two matches apart, so both would be written to one log (`planSeries` in
`packages/runner/src/series-plan.ts`). It was played by `scripts/mirror-series.mjs`, which takes the
same command line and draws the seeds through
`planSeries` itself, then plays both seat orders through `runMatch` and writes the record with the
runner's own `writeSeriesRecord`:

```bash
node scripts/mirror-series.mjs series --game salient --a bot:greedy --b bot:greedy \
  --name greedy-vs-greedy --max-pairs 10
no-dice evidence --series series/greedy-vs-greedy
```

**`no-dice series` plays a mirrored pairing now, and names its logs the way that script did.**
A pairing whose two seats fold to one slug has a seat map that reads the same in both seat orders,
so its two matches carry the seat the pairing's first seat plays as well:
`<seed>-greedy-greedy-A.json` and `-B.json` — the same letter the record's `seat` field already
carries, and the name the resume rule reads. So the command below plays the same 20 matches on the
same seeds, and a series either of the two started is resumed by the other:

```bash
no-dice series --game salient --a bot:greedy --b bot:greedy --name greedy-vs-greedy --max-pairs 10
```

The script stays, because the kept copy above was played by it and
`docs/rules-review.md` points at it.

Greedy against Greedy is a true mirror — every match is a draw, and the two seat orders of a pair
give the same score — so those 20 matches are 10 positions played twice. Its logs are gitignored
like the first bot series', so the copy is the only half that survives, and unlike the marvin
series' it is not covered by the kept-copy drift test (`scripts/kept-series-evidence.test.mjs`),
which regenerates only from tracked logs. What is reproducible is the series itself: replaying
the command above on 8 October 2026 wrote 20 logs whose `evidence.md` is identical to the kept copy
but for the line naming the directory it was pointed at.

`.gitignore`'s series pattern is anchored to `/series/` for this to work at all:
unanchored, `series/` matched `reports/series/` too and the report could not be
tracked. The runner's own series directories are all at the repository root, so
anchoring costs nothing.

---

## 8. The rerun: the same five maps played again, on 2026-10-07

Run 1's two kept documents are all of run 1 that survives. The same pairing
was played again on 2026-10-07, and this time the record was kept on purpose.
This section is that run's sections 1 to 6 in one place — the command, the
ceiling, the concurrency, the wall time, the matches that went missing, where
the copies are — and every figure in it is **run 2**'s, never pooled with run
1's. Its win rate, margin and seat split are in the report, not here: **2 wins
in 10, 20.0% with a 95% Wilson interval of 5.7% – 51.0%**, mean margin 18.5,
no knockouts.

**The command, verbatim:**

```bash
no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 5 --max-tokens 60000000 --concurrency 1
```

The same `--max-pairs 5` pair limit, the same `--max-tokens 60000000` ceiling
of section 2, the same `--concurrency 1`, `--seed-base` left at its default.
**Jim ran it himself from his own clone, `/home/jim/code/no-dice`, and not
inside a task workspace** — which is the lesson of sections 6 and 7: a series
played inside a task workspace is caught by the anchored `/series/` rule and
deleted with it, and that is what cost run 1 its logs. It wrote
`/home/jim/code/no-dice/series/marvin-subagent-vs-greedy/`. The seat's Pi
version, thinking level and window are unchanged from section 1's table — Pi
1.0.2 in RPC mode, `thinking medium`, `contextWindow: 131072`,
`maxTokens: 8192`, `cost_usd: 0` on every turn because Marvin is unpriced.
**What did change is how the seat is given its tools** — `2b83df8`, two hours
before the rerun started, registers the seven under the game's own bare names
through `seat-tools.ts` against `SALIENT_URL`/`SALIENT_TOKEN` instead of an
`mcp.json` that prefixed them `mcp__salient__` — which is the surface that
cost run 1 two matches, so section 5's story does not carry over.

**It is a new series, not a continuation of run 1.** Run 1's `series/`
directory is gone (section 6), so `planSeries` had no `series.json` to read:
`seedBase` fell back to the default `0` and `drawSeeds` drew a fresh list,
which at five pairs gives back exactly the five seeds run 1 drew —
**572152369, 708123, 479473028, 313966722, 1003578858** — and so the same ten
maps. The records are not one record, and neither is the harness: three
commits of 2026-10-06 and 2026-10-07 sit between the two runs — `749d236`,
which made a call to one of the seven by its bare name a *refused* call rather
than a `tool_surface` void (section 5); `0a78f80`, which went further and
made **no tool name a void at all**, since Pi's lock-down answers any name the
seat was not given with "not found", so the harness logs the call as refused
and the turn goes on, leaving `harness_crash` as the only `VoidReason` left;
and `2b83df8`, which gave the tools the game's own bare names. Run 1 was
played before all three, so the two runs are **separate samples of the same
ten maps**, never one series of ten pairs.
[`docs/rules-review.md`](rules-review.md) labels every figure it quotes run
1's or run 2's for that reason, and run 1's kept report stays where it is.

**Wall time, start to finish: 2 h 48 m 28 s**, 2026-10-07 22:00:41Z to
2026-10-08 00:49:09Z — against run 1's **5 h 27 m 44 s**. Both ends come out
of the tracked logs: each match's `created` stamp less the sum of the **model
seat's** per-turn `wall_ms` gives its start — the Greedy seat records 0 ms a
turn, so summing both seats would only look right by accident.

| pair | seed | pair finished | minutes |
| --- | ---: | --- | ---: |
| 1 | 572152369 | 22:35:08 | 34.4 |
| 2 | 708123 | 23:02:09 | 27.0 |
| 3 | 479473028 | 00:49:09 | 37.8 |
| 4 | 313966722 | 00:06:08 | 30.4 |
| 5 | 1003578858 | 00:28:03 | 21.9 |

**21.9 to 37.8 minutes a pair** against run 1's 63.5 to 74.8, and **9.6 to
23.8 minutes a match** against run 1's 56 to 75 for a played match. A pair's
minutes are its two matches' own turn time added, and pair 3's row ends at a
replayed log (below), which is why its finish time sits after pair 4's and
pair 5's.

Two things account for the difference, and the first is not the machine.
Commit `9049e4f` ("runner: `--concurrency` bounds matches, so at 1 a pair's
two matches take turns") landed in that clone at 22:00:34Z, seconds before
this run's first turn, so the rerun played under the new rule:
`--concurrency 1` puts **one match** in flight and a pair's two matches take
turns one after the other. Section 3's "a pair's two matches are played
together" is run 1's runner, not this one. One seat in flight means one seat's
conversation in Marvin's KV cache, and the cache says so: **98.3% of the
rerun's prompt tokens were cache reads** — 58,125,343 cache-read of its
59,109,607 prompt tokens, which is 96.9% of the 59,967,929 total — against run
1's 14.2% to 80.4% a match.

The second is contention, and this is where that caveat lives. **The rerun was
played by hand, by Jim, outside the factory**, and the task that asked for it
said in terms that nothing else on the box should send Marvin requests while
it played; with one match in flight, the single-request server had one seat
queueing on it. The record bears that out: of the model seat's 250 turns, **0
were `timeout` passes and 0 were `provider_error`**, its slowest turn took
**141.6 s** against the 300 s cap, and only 2 turns passed at all — both
`no_submission`, both in turns 1-8. Run 1's **34 `timeout` and 18
`provider_error`** passes are to be read against that: section 3 says the
factory's own builder agent was on the same one-request-at-a-time server while
run 1 played, so run 1's per-turn times and pass counts measure a
**contended** server and the rerun's measure a seat playing alone. Nothing in
either report says which of run 1's 53 passes were the queue's, and the two
runs' pass counts are not comparable.

**The matches that went missing: none — 10 counted, 0 missing**, against run
1's 8 of 10, and `series.json` records `matches_failed: 0` with
`stop_reason: "max_pairs"` and `stopped_early: false`: the pair limit reached
at the series' full length.

The two matches run 1 lost to a bare `submit_orders` (section 5) both produced
logs this time — but **not because a bare-name slip was refused.** Under
`2b83df8` the bare name *is* the tool's name, so the model seat's 283
`submit_orders` calls here reach the tool like any other — the game rejects 25
of their submissions, which is a rules matter and not a harness one — and
under `0a78f80` `tool_surface` is not a void reason any more:
`packages/harness/src/player.ts` keeps it as a reason an older log can carry
and says none does now. Nothing in the rerun's 1,402 logged tool calls
was refused at all — their only errors are game-level, `invalid_submission`,
`already_submitted` and `unknown_enemy_hex`. The transcripts show the new
rule from the other side: **seed 572152369, seat A called `write`**, a tool
outside the seven, Pi answered `Tool write not found`, and the match played
on to turn 25 — a match `749d236`'s harness would have voided. So the thing
that cost run 1 two matches no longer exists as a way to lose one, and that is
why the two runs' `tool_surface` rows are not comparable.

One match was played twice, and it is not a missing one. **Seed 479473028,
seat A**: the first attempt, 23:02:11Z to 23:18:03Z, ended with Pi's request
aborted on the turn-19 prompt — that seat's transcript ends on an assistant
message with `stopReason: "error"` and
`errorMessage: "This operation was aborted"` — so it wrote no log. The same
command run again after the rest of the series had finished skipped the nine
logs on disk and played only that match, 00:28:27Z to 00:49:09Z, which is pair
3's finish time above. The failed attempt's transcript is kept beside the
replay's under `series/marvin-subagent-vs-greedy/sessions/`, and nothing was
changed between the two attempts.

**What it cost: 59,967,929 tokens** over the ten counted matches — 984,264
input, 858,322 output, 58,125,343 cache-read, 0 cache-write — at `cost_usd: 0`
throughout, so tokens and wall time again. That is **99.9% of the 60,000,000
ceiling**, 32,071 tokens short of it, and 5,996,793 a match against run 1's
2,172,486. The ceiling did not stop the run — the pair limit did — and it did
not fire at the end either, because a ceiling fires only on a total *over* it:
32,071 tokens short is the difference, and that is the first caution below.

**Where the kept copies live.**
[`reports/series/marvin-subagent-vs-greedy-rerun.md`](../reports/series/marvin-subagent-vs-greedy-rerun.md)
and
[`reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`](../reports/series/marvin-subagent-vs-greedy-rerun-evidence.md),
copied verbatim out of
`/home/jim/code/no-dice/series/marvin-subagent-vs-greedy/` — its `report.md`
and its `evidence.md` — and still byte-identical to them. The evidence file is
what `no-dice evidence` wrote over the finished series:

```bash
no-dice evidence --series /home/jim/code/no-dice/series/marvin-subagent-vs-greedy
```

It reads only `series.json` and the logs, so it runs from anywhere over an
absolute path. Section 7's rule is why both files are there: `series/` is
gitignored, so what outlives a run is what was copied somewhere tracked, and
run 1 copied its report and not its evidence. Both copies name absolute paths
on the machine that played the series, which is what the two generators write.

This run beat section 7's rule in one respect: **its whole series directory is
tracked as well**, at `series/marvin-subagent-vs-greedy/` — `series.json`,
`report.md`, `evidence.md`, the ten match logs and the seats' transcripts —
unignored by the `!` lines in `.gitignore` and committed by Jim as a second
baseline. So the rerun's five counters can be regenerated from the logs they
were counted out of, which run 1's never could, and
[`scripts/kept-series-evidence.test.mjs`](../scripts/kept-series-evidence.test.mjs)
regenerates the kept evidence copy from those logs and fails if the two
disagree.

**How to extend it.** The same command at a higher `--max-pairs`, run in the
directory Jim ran it in — `/home/jim/code/no-dice`, his own clone, not a task
workspace and not this checkout — resumes from the logs on disk there:
`planSeries` reads that directory's `series.json`, keeps the seed list it
holds, appends to it, and a match whose `matches/<seed>-<seat-map>.json`
exists is skipped (section 6). `--dir <path>` points at the same directory
from elsewhere. At `--max-pairs 10` the second batch of five pairs is where
the adaptive stop becomes available, `MIN_TEST_PAIRS` being 10 pairs.

Two cautions before anyone does. **The ceiling will not stop the next run, and
it is worth knowing what will.** A ceiling fires only when the total is *over*
it (`ceilingFired` in `packages/runner/src/series-stop.ts`), and this series
finished 32,071 tokens **under** its 60,000,000, so the pre-batch ask
(`ceilingsPassed`) returns null: the same command at `--max-pairs 10` plays
the whole second batch of five pairs — on this series' rate, roughly another
60M tokens and 2.5 h — and stops at the boundary after it on `max_pairs`,
because there the pair limit is asked before the ceilings. The 59,967,929
already spent is not free, though: it counts towards the ceiling, so a run
given `--max-pairs 15` is stopped by `max_tokens` at the boundary after that
second batch rather than playing a third. Set `--max-tokens` deliberately to
what the extra pairs are worth, instead of finding out at a boundary. And
**that directory is outside the repository and nothing in git protects it:**
the tracked copy under `series/marvin-subagent-vs-greedy/` is a copy, and a
resumed run reads the `series.json` and the logs it is run beside. If
`/home/jim/code/no-dice` goes, the resumable series goes with it, and what
remains is the kept copies of section 7 and the tracked copy of what was
played on 2026-10-07.
