# Rules review: the open questions against the first real series

`salient/docs/salient-rules-v0.md` leaves eight questions open. This file takes each one in
turn, puts the numbers from the first real series beside the numbers the rules quote for scripted
bots, and ends with either a decision or the evidence that would settle it.

Sources, all of them in the repository:

- [`reports/series/marvin-subagent-vs-greedy.md`](../reports/series/marvin-subagent-vs-greedy.md) —
  the series report, copied verbatim from `series/marvin-subagent-vs-greedy/report.md`.
- [`docs/series-notes.md`](series-notes.md) — what was actually run: the command, the ceiling, the
  concurrency, the wall time, the missing matches.
- [`docs/pi-harness-notes.md` §7](pi-harness-notes.md) and
  [`reports/pi-cost.md`](../reports/pi-cost.md) — the one-match cost measurement, seed 135.
- [`salient/docs/salient-rules-v0.md`](../salient/docs/salient-rules-v0.md) — the questions, and
  the bot figures quoted against them.

**How to read the verdicts.** A rules decision is Jim's, so nothing here is ticked in
`salient/docs/salient-rules-v0.md`: no box has been moved to "Decided", because no decision has
been made. Where a `**Decision:**` line appears, it is what the numbers support and what to do
next, written for him to accept or refuse; where a `**Left open:**` line appears, the
numbers that would close it are named with it. Every verdict says which matches a change would
force to be replayed. A decision that changes the engine is not implemented here — it goes to the
next epic.

---

## The series every section reads from

`marvin/subagent` (Pi 1.0.2, RPC mode, `thinking medium`, `contextWindow` 131,072, `maxTokens`
8,192) against `bot:greedy`, five seat-swapped pairs, `--max-tokens 60000000`, `--concurrency 1`.

| | |
| --- | --- |
| pairs recorded / matches | 5 / 10 |
| counted / missing | **8** / **2** (voided for `tool_surface` over a bare tool name, which the harness no longer voids — `749d236`, see Guessing check) |
| marvin/subagent | 0 wins, 8 losses, 0 draws — **0.0% win rate, 95% Wilson interval 0.0% – 32.4%** |
| seat split | seat A 0–4 (0.0%, 0.0% – 49.0%), seat B 0–4 (0.0%, 0.0% – 49.0%) |
| margin | mean **33.9**, bootstrap **27.3 – 41.5** (2000 resamples, 95%) |
| knockouts | **none** — all 8 ended `time` at turn 25 |
| stop reason | `max_pairs`, its full length; the interval test needs `MIN_TEST_PAIRS = 10` pairs and the series had 5 |
| wall time | 5 h 27 m 44 s for five pairs — 63.5, 74.8, 56.4, 62.7, 70.3 min a pair |
| tokens | 17,379,888 over the 8 counted matches — 2,172,486 a match, 29% of the ceiling |

The model seat's depth split, which most sections below read (200 turns = 8 matches × 25):

| marvin/subagent | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns passed | 53 | 15 | 16 | 22 |
| — timeout (300 s cap) | 34 | 12 | 12 | 10 |
| — provider_error | 18 | 2 | 4 | 12 |
| — no_submission | 1 | 1 | 0 | 0 |
| rejected submissions | 17 | 7 | 4 | 6 |
| tool errors | 16 | 9 | 5 | 2 |
| wasted orders | 1 | 1 | 0 | 0 |
| tool calls / turn | 2.35 | 3.05 | 2.40 | 1.61 |
| scouts / turn | 0.28 | 0.63 | 0.22 | 0.02 |
| simulations / turn | 0.26 | 0.30 | 0.33 | 0.13 |
| tokens / turn | 86,899 | 48,090 | 100,376 | 110,548 |
| context mean tokens | 39,890 | 16,800 | 43,076 | 59,398 |
| context max | 85,963 | 35,488 | 60,984 | 85,963 |
| compaction turns | 7 | 0 | 5 | 2 |

Greedy's own row is the control: 408 tool calls at 2.04 a turn, **0** scouts, **0** simulations,
**0** tool errors, **0** rejected submissions, **0** passes, **0** compaction turns — it runs no
provider, so it has no context to lose.

## The five counters, none of them reachable from here

The rules' questions are stated as counts — hex flips a turn, lead changes a match, Node hand
changes, neutral captures, re-scouts. `packages/stats/src/rules-evidence.ts` computes all five
from a match log alone, and `no-dice evidence --series <dir>` writes them to
`series/<name>/evidence.md`. **Nothing of it survives.** `series/` is
gitignored because a real log is 0.9–1.1 MB of tool results
([series-notes §7](series-notes.md)); the report was copied into `reports/series/` and the
evidence file was not; and the directory the report header names —
`/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/marvin-subagent-vs-greedy` —
was written inside the `series-real-run` task's own workspace and deleted when that task merged,
as [series-notes §6](series-notes.md) records. Checked on this box: `no-dice evidence --series
series/marvin-subagent-vs-greedy` answers `series.json is not there, so there is no series to
report`; a filesystem-wide search finds no `series.json`, no `evidence.md` under any `series/`
directory, and no match log named for any of the five seeds; and no commit reachable from a ref,
nor any of the five commits unreachable from one, holds a series evidence file. Marvin answers
`/v1/models` from here, so the endpoint is not what is missing.

**The logs are gone, and unless a backup exists outside this box the five counters have to be
re-earned by playing again.** The one thing this review can act on without a model is the reason
they went missing: the counters exist as code, the run computed them, and nothing copied the
answer somewhere that survives.

So the four sections that turn on those counts — Home bonus, Final-turn lunge, Centre Node
ping-pong, No last-seen memory — carry the real-series numbers the report *does* hold, and are
`Left open` on the counter itself rather than on the sample size. That is a different kind of
open than "ten matches is not enough", and it needs no new code: `rules-evidence.ts` already
computes all five, and `no-dice evidence` already writes them. What they need is logs that survive
the run that made them — which is what the closing section is about.

---

### Home bonus

The rules' bot figures: without the home bonus, bot matches flipped **about 6.5 hexes a turn late
on** and the lead changed **3.2 times a match**, mostly from single troops trading empty hexes;
with it, **1 to 2.4 hexes** flip and the lead changes **1.4 times**.

| | bots without | bots with | marvin/subagent vs Greedy |
| --- | ---: | ---: | ---: |
| hexes flipped a turn, turns 18-25 | 6.5 | 1 – 2.4 | **no surviving record** |
| lead changes a match | 3.2 | 1.4 | **no surviving record** |
| captures of neutral hexes | "single troops trading empty hexes" | — | **no surviving record** |

What the series does say about the shape of these matches: Greedy won all 8 by a mean margin of
**33.9** on a 93-point board, with a bootstrap interval of **27.3 – 41.5** — a narrow band of
one-sided results, which is the pattern of a match whose lead is settled early, but that is an
inference from the margin and not a measurement of the lead. **No match ended in a knockout**,
against the bot baseline's 14%–21% of knockouts (only ever against Random) and none between Greedy
bots. And the late game is where the model stopped contesting anything: **22 of its 64 turns in
18-25 were passes**, **1 scout in 64 turns** against 40 in the first 64, and tool calls per turn
fell 3.05 → 1.61. A seat that passes a third of its late turns does not trade hexes in them, so
the flips-per-turn figure for this pairing would be expected to read low for a reason that
has nothing to do with +1: it would measure the model falling out of the game, not the bonus.

**Left open:** the home bonus is not testable from this pairing. What would settle it is
`no-dice evidence` over a series of at least 10 pairs — `MIN_TEST_PAIRS = 10` is also the point
where the win-rate interval test starts — giving flips per turn over 18-25 and lead changes per
match, quoted beside 6.5 / 1–2.4 and 3.2 / 1.4, and a pairing where the model is competitive
enough to be flipping hexes on turn 22. Any change to +1 invalidates every match in this series:
all 8 counted matches and the 2 voided ones would be replayed at the same seeds, since a seed
reproduces its map exactly.

### Final-turn lunge

The rules' worry: a fixed last turn rewards all-in attacks that have no follow-up cost, and
scoring the average of the last few turns would remove that. The test is whether turn 25's swing
and its neutral captures stand out from turn 24's.

The two counters this needs — the largest single-turn swing with the turn it happened on, and
captures of neutral hexes per turn band — have no surviving record. What the report holds is the
behaviour around the last turn, and it points the other way: all 8 matches ran to turn 25 with no
knockout, and the 18-25 band is the model's worst, with **22 of 64 turns passed** (10 timeouts,
12 provider errors), **1 scout**, **8 simulations** against 24 in the middle band, and
**12 of its 18 provider errors** in that band. The model did not lunge at the horizon; it stopped
acting before it. Greedy played under the same fixed horizon, took 2.00 tool calls a turn in both
late bands, and won every match by 33.9 without needing an all-in turn at the end of one.

**Left open:** whether turn 25 swings harder than turn 24 needs the largest single-turn swing and
the neutral-capture counts per band from `no-dice evidence`, over a series long enough to have a
turn-25 distribution at all (10 pairs is 20 matches, 20 turn-25s), and against a seat that still
submits on turn 25 — 22 of this series' 64 late turns were passes, so its turn 25 is mostly a
record of nothing happening. Scoring the average of the last few turns would change the result of
every match in the series, so all 10 would be replayed at their seeds; the 8 counted ones would
also need their margins recomputed, since the margin feeds the series statistics.

### Centre Node ping-pong

The rules' worry: in some bot matches the centre Node (F6) changed hands on alternate turns,
because the bots attack with the exact minimum. The counter is a ping-pong flag — a Node changing
owner on three or more turns with at least two of them consecutive — and no output of it survives
this series.

The conditions for it were present. Greedy's whole behaviour is taking Nodes, it won 8 of 8
by 33.9, and it did it with **0 scouts in 200 turns**: it attacked Nodes on always-known terrain
with no recon at all, which is exactly the minimum-force attack the rules describe. The model
seat scouted 57 times, but **40 of those 57 scouts were in turns 1-8 and 1 was in 18-25**, so it
too had stopped re-looking at F6 by the time the late game was being decided. No match ended
in a knockout, so neither side ever converted an approach into the 93-to-0 prize.

**Left open:** the ping-pong flag over at least 10 pairs, plus the Node hand changes per turn band
that go with it, from `no-dice evidence` — the counter exists and needs no new code. If it
fires, the fix is not a rules change but a look at whether attacking with the exact
minimum is meant to be rewarded; that goes to the next epic as an engine question, with no task
filed for it yet (the closing section marks it as owed one). Nothing here would force a replay
unless the combat or garrison rule changes, in which case all 10 matches are replayed at their
seeds.

### No last-seen memory

The rules' question: the engine does not report what a player saw on earlier turns, so should
`get_state` show last-seen values? The test the brief sets is re-scouts per seat per match — a
seat that re-scouts the same hexes over and over is paying tool calls for memory the engine could
hand it. Re-scout counts have no surviving record either.

What the report shows instead is the opposite failure, and it is a strong signal. The model seat
scouted **57 times in 200 turns — 0.28 a turn**, against the harness's 12-call cap — and the rate
collapses with depth: **0.63 a turn in 1-8, 0.22 in 9-17, 0.02 in 18-25**, one scout across the
whole last third of the series. Its total tool calls per turn fall the same way, 3.05 → 2.40 →
1.61, while its context grows from a mean of 16,800 tokens to 59,398. So the seat did not spend
its budget re-buying memory; it stopped asking about the board at all as its conversation got
heavier. Greedy scouted 0 times and won 8 of 8, which says the information advantage in this
pairing was not with the seat that had the tools.

**Left open:** re-scouts per seat per match (scouts of a hex label that seat already scouted) and
the distinct-hex count, from `no-dice evidence` over at least 10 pairs, and a second model whose
scout rate does not fall to 0.02 a turn — one model that gives up on recon cannot answer a
question about whether recon is being paid for twice. Adding last-seen values to `get_state`
changes what every model seat sees from turn 2 on, so all 8 counted matches and the 2 voided ones
would be replayed at their seeds; Greedy's matches would not change, since it never scouted.

### Compaction

The rules' question: summarising the oldest context keeps a small-window model in the game but
changes what it remembers; the alternative is to let it fail when it runs out of room. Whether any
match of a real series compacts at all is answerable now, and the answer is yes — often, and
early.

The series recorded **7 compaction turns**, all on the model seat (Greedy: 0, it runs no
provider). They are spread over **all five seeds** — 572152369 turn 9, 708123 turn 13, 479473028
turn 15, 313966722 turns 15 and 20, 1003578858 turns 17 and 21 — so **at least 5 of the 8 counted
matches compacted at least once**. The report names seeds, not which match of a pair each turn
came from, so the exact number of matches is not recoverable from it. By band: **0 in turns 1-8, 5
in 9-17, 2 in 18-25**, the first on turn 9.

That expectation does not carry over to the series: seed 135 reached **94,659 of its
131,072 window (72.2%), growing 3,541 tokens a turn, and never compacted**, because Pi's threshold
is `contextWindow − 16,384 = 114,688`. The series' largest end-of-turn `context_tokens` is
**85,963**, below that threshold, yet it compacted seven times — because `context_tokens` is the
conversation sampled at the end of a turn while Pi's threshold check runs mid-turn over the
pending tool results ([series-notes §4](series-notes.md)). A series budget that assumes §7's
"never compacts" has it backwards: the mid-turn check is what fires compaction, and it fired
on every seed of this one.

The half of the question the series cannot answer is whether compaction turns carry worse play.
The depth split shows the errors rising late — provider_error passes **2 → 4 → 12**, turns passed
**15 → 16 → 22** — while tool errors *fall* **9 → 5 → 2** and rejected submissions stay flat
**7 → 4 → 6**. But the report splits by turn band, not by compaction turn, and the five
compactions in 9-17 sit in a band with only 4 provider errors, so nothing here attributes an
error to a compaction. That join needs the per-turn `compacted` flag against the per-turn error
counts, which is one pass over the logs — logs that no longer exist.

**Decision:** recommended, not taken — compaction stays on and the rules' alternative, let it
fail when it runs out of room, is refused on these numbers; Jim confirms it in brief §11. It is
not a hypothetical failure: the seat already lost **18 turns to provider errors** and **34 more to
the 300 s cap**, so 53 of its 200 turns were already lost to the harness, and removing the one
mechanism that keeps a 25-turn conversation inside its window would add to that count rather
than protect anything. No engine or
config change, nothing to replay. The place this is answered is the brief §11 open item **"Whether
compaction stays on, after seeing how often it happens"** — how often it happens is now measured
(7 turns, every seed, the first on turn 9), so the item can be answered. Until Jim answers it
there, the box in `salient/docs/salient-rules-v0.md` stays unticked and this line is a
recommendation with numbers under it, not a decision. What is still owed alongside it is the
attribution — compaction turns against error counts on those turns — which the next series should
record.

### Cost growth

The rules' question: each turn re-sends the whole conversation, so input tokens grow through the
match — measure a full match before the first series. That was done before the series ran, and it
is closed.

Seed 135, one 25-turn match, seat A ([§7](pi-harness-notes.md),
[`reports/pi-cost.md`](../reports/pi-cost.md)): **4.59M tokens** — 222,148 input, 61,748 output,
4,301,838 cache-read, 0 cache-write, over **4,523,986 prompt tokens** — with **95.1% of the prompt
served from Marvin's cache**, and **the five turns that read under 90% from the cache are the five
slowest turns of the match**: turn 1 at 6.6% (164.6 s), turn 2 at 72.2% (99.5 s), turn 3 at 63.2%
(66.4 s), turn 4 at 30.5% (135.1 s), turn 17 at 66.9% (70.5 s); the other twenty sit at 98.6–99.6%
cached and 14.4–52.0 s. Context grew 9,675 → 94,659, 3,541 tokens a turn.

The series confirms the growth and corrects the budget. Tokens per turn on the model seat go
**48,090 → 100,376 → 110,548** across the depth bands, a 2.3× rise, with context means
16,800 → 43,076 → 59,398. But the match total is **2,172,486 tokens a match** (17,379,888 over 8),
less than half §7's single match, and the cache share — the thing that makes re-sending the
conversation affordable — fell to **14.2%–80.4% a match** against §7's 95.1%, because two seats
evicted each other's KV cache on one llama.cpp server at `--concurrency 1`
([series-notes §3](series-notes.md)). The cost of that is time, not money: 34 of 200 turns hit the
300 s cap and the run took **5 h 27 m 44 s** for five pairs, against §7's 18.8 minutes for one
match played alone. At the series' own 65.5 minutes a pair, a 150-match series is about 82
hours of Marvin, not §7's 48.

**Decision:** closed as measured, no rules change and nothing to replay. What it changes is the
budget, not the game: the brief §11 ceiling Jim set for this series, `--max-tokens 60000000`, was
not the binding constraint — the series spent 17,379,888 of it (29%) — and wall time is, so the
next series should be sized in hours against the measured 65.5 minutes a pair rather than in
tokens against §7's per-match figure.

### Own-orientation boards

The rules' question: showing each player the board with its own Base on the same side would remove
seat bias at the source, but the renderer would then have to translate hex labels in intent text.

This is out of scope for v0 — brief §3 lists it among the things v0 does not build — and the
series gives no reason to pull it in. The mechanism v0 does use, playing every pair twice, worked
at this length: **seat A 0–4 and seat B 0–4, with identical 95% Wilson intervals of 0.0% –
49.0%**, and the report's own note that "A gap between them is the board, not the model, and
it is why every pair is played twice" describes a gap of exactly zero. That is a weak confirmation,
not a strong one — four matches a seat cannot detect a modest seat effect — but it is the honest
reading of the only seat-effect figures that exist.

What it would cost, if it were ever done: a per-seat transform of the board in `get_state` and the
prompt, hex-label translation in the renderer's intent and prediction text (both capped at 280
characters, and the model quotes hex labels in them), and a re-derivation of the
symmetry test, which currently hands each bot the board in its own orientation and draws on
300 maps. And every model match ever played would have to be replayed, because seat B saw the
board the other way round: all 8 counted matches and the 2 voided ones.

**Decision:** stays out of scope for v0, exactly as brief §3 has it. No engine change, no replay,
nothing to propose to the next epic. Reopen it when a pairing is close enough that a seat effect
could decide a series — and measure the effect first with the seat-effect rows over 10+ pairs,
which costs nothing, before changing what every seat sees, which costs the whole series.

### Guessing check

The rules' question: if the Greedy bot beats a strong model often, simultaneous turns are too much
of a guessing game and the rules need more depth.

The headline fires the trigger: Greedy won **8 of 8**, the model's win rate is **0.0% with a 95%
Wilson interval of 0.0% – 32.4%**, the mean margin is **33.9 points (27.3 – 41.5)** on a 93-point
board, and the seat split is nil, so it is not the board doing it.

The confounder is in the same report, and it is large. Of the model's 200 turns, **53 ended as
passes** — 34 at the 300 s turn cap, 18 provider errors, 1 no submission — and **17 submissions
were rejected** by the server, with 16 tool errors and 1 wasted order. Greedy passed 0 turns,
submitted 0 invalid sets, made 0 tool errors, and used 408 calls at 2.04 a turn. A seat that does
not act on a quarter of its turns is not losing to a guessing game; it is losing to a slow
endpoint and a 300-second clock, and the two voided matches are a further two of ten lost to a
tool-name slip rather than to any decision on the board. The interval itself says the sample is
thin: 0.0% – 32.4% is the width an 8-match series gives, and the adaptive stop never ran because
`MIN_TEST_PAIRS` is 10 pairs and this series had 5.

**Decision:** no change to the simultaneous-turn rules on this evidence, and nothing to replay.
The guessing check is not answered — it is blocked — and the thing to fix first is the harness,
not the rules: turn latency and the tool-name slip are what put 53 turns and 2 matches out of
play.

**One of those two is already fixed, three hours after this series finished.** Commit `749d236`
changed `packages/harness/src/pi-player.ts` so that a call to one of the seven by its bare name —
`submit_orders` for `mcp__salient__submit_orders`, which is what voided seeds 479473028 and
313966722 — is logged as a refused call and the turn carries on, instead of voiding the match for
`tool_surface`. A tool outside the seven still voids it. A re-run should not lose matches this way,
so of the two confounders only turn latency is still owed.

That fix has a cost for the recommendation below it: **a re-run is played under a different
harness rule from this series.** The 10 matches above were played by a harness that voided a
bare-name call; the next ten will be played by one that does not, so they are not matches played
under identical conditions — the same comparability problem [series-notes §5](series-notes.md)
cites for changing nothing mid-series. It bites the report's own rows: both missing matches are
`tool_surface` voids the new harness would not have made for that reason, so the two reports'
missing-match rows are not the same measurement, and a new series' win-rate interval will be
computed over ten matches none of which is one of these 8. Read the seat split and the
missing-match rows of this report as belonging to this series alone.

Re-run the check on a series of at least 10 pairs in which passes are a small share of turns and
both matches of every pair produce a log; if Greedy still wins above 50% with the interval
excluding 50%, the depth change goes to the next epic as an engine question, and every match in
the series would be replayed at its seeds.

---

## What would close the four open sections

Nothing of the first series is left to resume — [series-notes §6](series-notes.md) records the
deletion — so this is a re-run, plus one change to what the repository keeps:

1. `no-dice series --game salient --a marvin/subagent --b bot:greedy --name
   marvin-subagent-vs-greedy --max-pairs 10 --max-tokens 60000000 --concurrency 1` — **a new
   series, not a continuation of the first.** With no `series.json` on disk, `planSeries` falls
   back to `DEFAULT_SEED_BASE` and draws a fresh list, so the command plays all ten pairs
   into a new `series/marvin-subagent-vs-greedy/`, and the `series.json` and `report.md` it writes
   describe that series alone. The 8 matches already played are not in it: they exist only as the
   numbers in the kept report. The maps are the same ones — the draw is a stream from one base, so
   a fresh draw from base `0` starts with the five seeds §1 of the series notes lists, which is
   what a fixed `seed_base` is for — but the record is new ([series-notes §6](series-notes.md)).

   **Read the two reports as two series, not one sample.** Nothing is stitched together: the new
   run replays all ten pairs. But the ten new matches are played after `749d236` turned a
   bare-name call from a `tool_surface` void into a refused call, and the ten in the standing
   report were played before it, so the figures do not carry across that line — the old report's
   missing-match row counts voids the new harness would not make, and its 0.0% – 32.4% interval
   belongs to the old ten alone. That is the judgement [series-notes §5](series-notes.md) already
   made about not changing the prompt mid-series, and it is Jim's to make about the name: reuse
   `marvin-subagent-vs-greedy` and keep two reports under one name, or pick a fresh name so the
   directory says which harness played it. Either way the 17,379,888 tokens and 5 h 27 m already
   spent stand as history, not as part of the new sample.
2. `no-dice evidence --series series/marvin-subagent-vs-greedy` afterwards, and the resulting
   `evidence.md` kept in `reports/series/` beside the report the way `report.md` is kept. Without
   step 2 the counters are computed into a directory that is deleted with the workspace, which is
   how this review came to have four sections with no counters in them.

At 10 pairs the interval test runs, the win-rate interval narrows, and each of the counters above
has 20 matches behind it instead of none.

Two engine questions are deferred in prose above and have **no task filed behind them**: whether
attacking a Node with the exact minimum is meant to be rewarded (Centre Node ping-pong), and whether
the simultaneous-turn rules need more depth (Guessing check). Neither can carry acceptance criteria
until the counters exist, so filing them now would file a task with nothing to test. They should be
filed out of the next series' `evidence.md`, and this paragraph is the marker that they are still
owed a task.
