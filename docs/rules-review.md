# Rules review: the open questions against the two real series

`salient/docs/salient-rules-v0.md` leaves eight questions open. This file takes each one in
turn, puts the numbers from the two real series of the same pairing beside the numbers the rules
quote for scripted bots, and ends with either a decision or the evidence that would settle it.

Sources, all of them in the repository:

- **Run 1** —
  [`reports/series/marvin-subagent-vs-greedy.md`](../reports/series/marvin-subagent-vs-greedy.md):
  the series report, copied by hand out of that run's own series directory,
  `/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/marvin-subagent-vs-greedy/report.md`,
  which no longer exists. It is the generator's output plus two hand-written notes added
  afterwards — one under "Missing matches", one under the "Compaction turns:" line
  ([series-notes §7](series-notes.md)). Its `evidence.md` was not copied and its logs went with
  the task workspace that played them, so run
  1 contributes a win rate, a margin, a seat split, a depth split and compaction turns, and none
  of the five counters.
- **Run 2, the rerun** —
  [`reports/series/marvin-subagent-vs-greedy-rerun.md`](../reports/series/marvin-subagent-vs-greedy-rerun.md)
  and
  [`reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`](../reports/series/marvin-subagent-vs-greedy-rerun-evidence.md),
  copied verbatim from the rerun's `report.md` and `evidence.md`. The rerun's whole series
  directory, `series/marvin-subagent-vs-greedy/` with its ten match logs, is tracked as well, so
  its counters can be regenerated; the two kept copies are what this file quotes.
- [`reports/series/greedy-vs-random-evidence.md`](../reports/series/greedy-vs-random-evidence.md)
  — the same five counters over a five-pair `bot:greedy` against `bot:random` series, the one
  pairing on this box whose counters are bot figures all the way down.
- [`docs/series-notes.md`](series-notes.md) — what was actually run: the command, the ceiling, the
  concurrency, the wall time, the missing matches.
- [`docs/pi-harness-notes.md` §7](pi-harness-notes.md) and
  [`reports/pi-cost.md`](../reports/pi-cost.md) — the one-match cost measurement, seed 135.
- [`salient/docs/salient-rules-v0.md`](../salient/docs/salient-rules-v0.md) — the questions, and
  the bot figures quoted against them.

**Which run each figure comes from.** Every figure below is labelled **run 1** or **run 2**, and
the two are never pooled. They are separate samples, because run 1 was played by the harness
before `749d236` turned a call to one of the seven tools by its bare name from a `tool_surface`
void into a refused call: run 1's two missing matches are missing for a reason the rerun's harness
does not have, and its win-rate interval is computed over 8 counted matches against the rerun's
10. They are the same five maps — the rerun left `--seed-base` at its default `0` and drew the
same five seeds, 572152369, 708123, 479473028, 313966722 and 1003578858 — so run 2 is those ten
maps played again under the later harness, not a continuation of run 1's record. Where a run-1
figure is quoted it is quoted as run 1's, and run 1's kept report stays where it is.

**How to read the verdicts.** A rules decision is Jim's, so nothing here is ticked in
`salient/docs/salient-rules-v0.md`: no box has been moved to "Decided", because no decision has
been made. Where a `**Decision:**` line appears, it is what the numbers support and what to do
next, written for him to accept or refuse; where a `**Left open:**` line appears, the
numbers that would close it are named with it. Every verdict says which matches a change would
force to be replayed. A decision that changes the engine is not implemented here — it goes to the
next epic.

---

## The two series every section reads from

Both runs are the same pairing at the same specs: `marvin/subagent` (Pi 1.0.2, RPC mode,
`thinking medium`, `contextWindow` 131,072, `maxTokens` 8,192) against `bot:greedy`, five
seat-swapped pairs, `--max-pairs 5`, `--max-tokens 60000000`, `--concurrency 1`.

**Run 1** — played before `749d236`.

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

Run 1's model-seat depth split (200 turns = 8 matches × 25):

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

**Run 2, the rerun** — the same five maps played again, after `749d236`, and the run that put the
five counters in the repository.

| | |
| --- | --- |
| pairs recorded / matches | 5 / 10 |
| counted / missing | **10** / **0** — the two matches run 1 voided over a bare tool name produced logs this time |
| marvin/subagent | 2 wins, 8 losses, 0 draws — **20.0% win rate, 95% Wilson interval 5.7% – 51.0%** |
| seat split | seat A 1–4 (20.0%, 3.6% – 62.4%), seat B 1–4 (20.0%, 3.6% – 62.4%) |
| margin | mean **18.5**, bootstrap **10.5 – 26.8** (2000 resamples, 95%), against run 1's 33.9 |
| knockouts | **none** — all 10 ended `time` at turn 25 |
| stop reason | `max_pairs`, its full length; the interval test needs `MIN_TEST_PAIRS = 10` pairs and the rerun had 5, so it recorded no stopping interval |
| tokens | 59,967,929 over the 10 counted matches — 5,996,793 a match, 96.9% of all of it read from Marvin's cache (98.3% of its prompt tokens) |

Run 2's model-seat depth split (250 turns = 10 matches × 25):

| marvin/subagent | series | turns 1-8 | turns 9-17 | turns 18-25 |
| --- | ---: | ---: | ---: | ---: |
| turns passed | 2 | 2 | 0 | 0 |
| — no_submission | 2 | 2 | 0 | 0 |
| — timeout (300 s cap) | 0 | 0 | 0 | 0 |
| — provider_error | 0 | 0 | 0 | 0 |
| rejected submissions | 25 | 6 | 10 | 9 |
| tool errors | 43 | 31 | 8 | 4 |
| wasted orders | 2 | 0 | 1 | 1 |
| tool calls / turn | 3.57 | 4.28 | 3.41 | 3.04 |
| scouts / turn | 0.30 | 0.64 | 0.23 | 0.04 |
| simulations / turn | 0.77 | 0.88 | 0.76 | 0.69 |
| tokens / turn | 239,872 | 114,628 | 288,100 | 310,859 |
| context mean tokens | 57,440 | 26,701 | 67,490 | 76,873 |
| context max | 114,038 | 62,881 | 113,786 | 114,038 |
| compaction turns | 6 | 1 | 1 | 4 |

The difference every section below reads: run 1's model seat lost **53 of its 200 turns** to the
harness — 34 at the 300 s cap, 18 provider errors, 1 no submission — and 22 of those 53 fell in
turns 18-25, so its late-turn figures measure a seat the endpoint had stopped answering. Run 2's
seat lost **2 of its 250 turns**, both `no_submission` and both in turns 1-8, with **0 timeouts
and 0 provider errors**, and its slowest turn took **141.6 s** against the 300 s cap — counted from
the per-turn `wall_ms` in the rerun's tracked logs, where no turn of either seat came near the cap.
Run 2's late-turn figures measure play.

Greedy's own row is the control in both runs: 408 tool calls at 2.04 a turn in run 1, 510 at 2.04
in run 2, and **0** scouts, **0** simulations, **0** tool errors, **0** rejected submissions,
**0** passes and **0** compaction turns in both — it runs no provider, so it has no context to
lose.

## The five counters, this time in the repository

The rules' questions are stated as counts — hex flips a turn, lead changes a match, Node hand
changes, neutral captures, re-scouts, and a ping-pong flag over the Node hand changes.
`packages/stats/src/rules-evidence.ts` computes them from a match log alone, and `no-dice
evidence --series <dir>` writes them to `series/<name>/evidence.md`. **Run 1's are still gone:**
its `evidence.md` was never copied out of the gitignored `series/` directory, and the directory
its report header names was deleted with the `series-real-run` task's workspace
([series-notes §6 and §7](series-notes.md)). **Run 2's are in the repository**, in
[`reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`](../reports/series/marvin-subagent-vs-greedy-rerun-evidence.md),
and — which is the part run 1 did not have — they can be recomputed: the rerun's `series.json` and
its ten match logs are tracked under `series/marvin-subagent-vs-greedy/`, and
[`scripts/kept-series-evidence.test.mjs`](../scripts/kept-series-evidence.test.mjs) regenerates
the kept copy from those logs and fails if the two disagree.

This is what the rerun's counters are, beside the figures the rules quote for scripted bots:

| counter | bots without the home bonus | bots with it | run 2, 10 matches | greedy vs random, 10 matches | greedy vs greedy, 20 matches |
| --- | ---: | ---: | ---: | ---: | ---: |
| hexes flipped a turn late on (turns 18-25) | 6.5 | 1 – 2.4 | **2.39** | 1.67 | 1.13 |
| lead changes a match | 3.2 | 1.4 | **0.60** | 0.00 | 0.00 |
| hex flips a match | — | — | **105.10** (4.20 a turn) | 87.50 | 89.60 (3.58 a turn) |
| captures of hexes that were neutral, a match | "single troops trading empty hexes" | — | **76.20** (7.54 / 1.69 / 0.09 a turn) | 75.50 | 74.60 (8.40 / 0.69 / 0.15 a turn) |
| Node hand changes a match | "the centre Node changed hands on alternate turns" | — | **7.60** (0.46 / 0.32 / 0.13 a turn) | 6.40 | **4.80** (0.33 / 0.13 / 0.13 a turn) |
| a Node ping-ponging | "in some bot matches" | — | **1 of 10** — seed 313966722, hex E5, turns 5, 19, 20 | 1 of 10 — seed 1003578858, hex H6, turns 14, 21, 22 | **0 of 20** |
| re-scouts, one seat a match | — | — | **1.70** for the model seat, 0.00 for Greedy | 0.00 for both seats | 0.00 for both seats |

The last column is a Greedy-vs-Greedy series, kept at
[`reports/series/greedy-vs-greedy-evidence.md`](../reports/series/greedy-vs-greedy-evidence.md) and
played for the Centre Node ping-pong question below. It is a true mirror — every match is a draw and
the two seat orders of a pair score the same — so its 20 matches are 10 positions played twice. Its
expansion rows are like the other bot series' (89.60 hex flips a match, 1.13 a turn late on,
inside the rules' 1 to 2.4); what sets it apart is the Node half, where it has the fewest hand
changes of the three series and no ping-pong at all.

The last two columns are different pairings, printed side by side for scale and never
summed: the greedy-vs-random column is two scripted bots, which is the kind of match the rules' own
figures were measured on, and the run-2 column is the model against Greedy. The bot-vs-bot column
carries a confound of its own, and the review does not read it straight: that series ran only **227
turns**, because **5 of its 10 matches ended before turn 25** (turns 18, 19, 21, 22 and 22), so its
turns 18-25 band is 57 turns rather than 80, and a knockout ends a match with no lead left to
change. Its 1.67 late-turn flips and 0.00 lead changes are therefore partly a knockout artifact.
The rules' two columns are the prototype engine's bot matches, from before either file existed.

---

### Home bonus

The rules' bot figures: without the home bonus, bot matches flipped **about 6.5 hexes a turn late
on** and the lead changed **3.2 times a match**, mostly from single troops trading empty hexes;
with it, **1 to 2.4 hexes** flip and the lead changes **1.4 times**.

| | bots without | bots with | run 2, 10 matches |
| --- | ---: | ---: | ---: |
| hexes flipped a turn, turns 18-25 | 6.5 | 1 – 2.4 | **2.39** (per match 1.25 – 3.63) |
| lead changes a match | 3.2 | 1.4 | **0.60** (3 of 10 matches changed the lead) |
| captures of neutral hexes | "single troops trading empty hexes" | — | **76.20** a match, 7.54 → 1.69 → 0.09 a turn |

The rerun settles the first row and half of the second. At **2.39 hexes flipped a turn over turns
18-25** it sits at the top of the with-bonus band of 1 – 2.4 and well under the 6.5 the rules quote
for bots without the bonus, so the late game of these ten matches is not the trading of empty
hexes the rules describe. The band shape says the same: hex flips per turn fall **7.54 → 2.86 →
2.39**, and captures of neutral hexes — what the without-bonus pattern was mostly made of — fall
**7.54 → 1.69 → 0.09**, which is 7 neutral captures across the last 80 turns, because by turn 18
the board is claimed. Run 1's same figures could not have said this: 22 of its 64 late turns
were passes and it made 1 scout in that band, so its late game measured a seat the endpoint had
stopped answering.

The lead-change row reads **0.60 a match**, below even the with-bonus 1.4, and that is the row
this pairing cannot read. Greedy won 8 of the 10, five of them by 18 points or more; the two
matches the model won, it won by 2 and by 6; the mean margin is 18.5 with a bootstrap interval of
10.5 – 26.8. A pairing with one seat ahead in four fifths of its matches has no lead to change —
the greedy-vs-random counters, computed by the same code
over ten bot matches, read **0.00** lead changes a match with 0 of 10 matches changing it, which is
a property of that pairing and not of +1 — and partly of how that series ended, since 5 of its 10
matches were knockouts before turn 25 and a knockout leaves no lead to change. So 0.60 is as
consistent with the bonus suppressing lead
changes as with a settled lead, and the rerun's own play does not separate the two: the model seat
submitted on every turn of 9-17 and 18-25 (0 passes in those bands), so this is not run 1's
confounder again.

**Left open:** the rerun says these matches are quiet late on, which is what the bonus is for; it
does not say +1 is the right size, because a pairing where one seat won 8 of 10 matches cannot
measure lead changes. The figures that close it are flips per turn over turns 18-25 and lead
changes per match from a 10-pair series of a pairing that changes the lead in at least half its
matches: flips per turn climbing toward 6.5 with lead changes toward 3.2 would say +1
is too weak, and a late game under 1.0 flip a turn with the lead settled by turn 8 would say it is
too strong. 2.39 and 0.60 do neither. Changing +1 changes combat, so it invalidates both runs: all
10 rerun matches would be played again at their seeds — their logs are tracked under
`series/marvin-subagent-vs-greedy/`, so the comparison is a fresh series against that baseline —
and run 1's 8 counted matches, which survive only as figures in the kept report, would stop being
comparable with anything.

### Final-turn lunge

The rules' worry: a fixed last turn rewards all-in attacks that have no follow-up cost, and
scoring the average of the last few turns would remove that. The test is whether turn 25's
swing and its neutral captures stand out from turn 24's. The rerun has both counters.

| what a lunge would look like | run 2, 10 matches |
| --- | ---: |
| largest single-turn swing, mean | **7.50** points |
| largest single-turn swing, highest match | **10** — seed 313966722, seat B, on **turn 11** |
| the turn each match's largest swing fell on | 4, 4, 9, 11, 13, 14, 16, 16, 19, 25 — a mean of turn 13.1, and one match in ten had it on turn 25 |
| captures of neutral hexes per turn, by band | **7.54** (1-8) → **1.69** (9-17) → **0.09** (18-25) |
| turn the lead last changed, over the 3 matches that changed it | 22.0 |

The counters read the opposite of the worry. The biggest single turn in any of the ten matches is
10 points and it fell on turn 11; the mean largest swing is 7.50 points and it falls on turn 13.1
on average; only one match, seed 479473028 in seat B, had its largest swing on turn 25, and that
was 9 points, not the series' largest. The horizon band is the quietest on the board: 191 hex flips
in 80 turns (2.39 a turn) and **7** captures of neutral hexes in 80 turns, 0.09 a turn, against 603
in turns 1-8. The last turn is not where the points move.

And this time the counter is not the harness talking. The model seat passed **2 of its 250
turns**, both `no_submission` and both in turns 1-8, and submitted on every one of its **170 turns
in 9-17 and 18-25** (90 and 80) — run 1's same bands had 16 and 22 passes, which is why run 1 could
only say the
model "stopped acting before" the horizon. It kept working late: 3.04 tool calls and 0.69
simulations a turn in 18-25 against 4.28 and 0.88 in 1-8. A seat that is still acting on turn 25
and does not swing hardest there is a seat that found no lunge worth making. Greedy played the same
fixed horizon at 2.00 tool calls a turn in both late bands and won 8 of 10 without one.

**Decision:** recommended, not taken — keep the fixed 25-turn horizon and refuse the alternative of
scoring the average of the last few turns, on these numbers; the box in
`salient/docs/salient-rules-v0.md` stays unticked until Jim says so. The counter that would reopen
it is named: turn 25 heading the largest-swing column in more than about a third of a 10-pair
series' matches, or neutral captures in turns 18-25 above 1.0 a turn against 0.09 now. Averaging
the last few turns changes the result of every match that runs to turn 25, so all 10 rerun matches
would be played again at their seeds and their margins recomputed — the margin is the input to the
series statistics — and run 1's kept mean margin of 33.9 would stop being comparable with
anything.

### Centre Node ping-pong

The rules' worry: in some bot matches the centre Node (F6) changed hands on alternate turns,
because the bots attack with the exact minimum. The counter is a ping-pong flag — a Node changing
owner on three or more turns with at least two of them consecutive — and the rerun ran it over all
ten matches.

| | run 2, 10 matches |
| --- | ---: |
| matches with a Node ping-ponging | **1 of 10** — seed 313966722, hex **E5**, turns 5, 19, 20 (19 and 20 consecutive) |
| Node hand changes a match | **7.60** (76 over the series) |
| Node hand changes per turn, by band | **0.46** (1-8) → **0.32** (9-17) → **0.13** (18-25) |
| the same counter over bot matches | 1 of 10 — seed 1003578858, hex H6, turns 14, 21, 22; 6.40 hand changes a match |
| **Greedy against Greedy, 10 pairs** | **0 of 20** — no Node changed owner twice in any match; 4.80 hand changes a match, 0.33 → 0.13 → 0.13 a turn |

It fires. One match in ten had a Node change owner on three turns with two of them consecutive, and
the bot-vs-bot counters kept beside these fire at the same 1-in-10 rate, so the pattern is not a
model quirk. Two things the flag does not say: the hex was **E5**, not the centre Node F6 the rules
name, and the consecutive pair was turns 19 and 20, not alternate turns — the counter catches a
Node changing hands twice running, which is the churn the rules worry about, but this is not the F6
seesaw the prototype showed. Otherwise Nodes change hands steadily and thin out with depth:
7.60 changes a match, 0.46 → 0.32 → 0.13 a turn. Greedy is the one doing it — it took Nodes with 0
scouts in 250 turns, on terrain that is always known, which is the minimum-force attack the rules
describe — and no match ended in a knockout, so neither seat converted the churn into the 93-to-0
prize.

The mirror pairing says the engine is not what makes a bot do it. A Greedy-vs-Greedy series — 10
pairs, 20 matches, kept at
[`reports/series/greedy-vs-greedy-evidence.md`](../reports/series/greedy-vs-greedy-evidence.md) —
has **no Node change owner twice in any of its 20 matches**: every one of its 96 Node hand changes
is a first capture of a neutral Node, and the two seats make each pair of them on the same turn, in
mirror image. The pairing is a true mirror — every match is a draw, and the two seat orders of a
pair give the same score — so those 20 matches are 10 positions played twice, and the 0 of 20 is a
sample of 10. Greedy does take a neutral Node with garrison + 1, the exact minimum the rules name,
and then keeps `attackers + 1` on a Node it already holds (`duties` in `games/salient/bots/src/greedy.ts`),
which is what stops it paying the recapture back. The churn the flag caught in run 2 is a
model's asymmetry, not an engine reward.

What the engine does allow is now stated in a test of its own,
[`games/salient/engine/src/node-ping-pong.test.ts`](../games/salient/engine/src/node-ping-pong.test.ts):
**the defence of a Node is the same 3 before and after it is taken.** A neutral Node stands at its
garrison of 3; a Node taken with the minimum is left with 1 survivor, gains the Node's +1 production
on the turn it was taken, and defends with the +1 home bonus, so it stands at 2 + 1 = 3. The same
4 troops that took it from the garrison take it back from the seat that took it a turn ago, and the
chain can run every turn: nothing raises the garrison again once a Node has been cleared, and a hex
taken this turn has no defence term it would not have after five turns. What the chain costs is 4
troops a hand change, against a Node that produces 1 a turn and is worth 3 points at scoring — a
stalemate that burns troops rather than a profit. One troop short of the minimum and the attack is a
tie, which destroys both stacks and leaves the Node to its owner, empty.

**Decision:** the watch the rules ask for is done, and the engine question it filed is measured and
closed. The minimum-force attack and the consecutive recapture it allows are pinned by
`games/salient/engine/src/node-ping-pong.test.ts`, and the bot rate beside the rerun's 1 of 10 is
the Greedy-vs-Greedy series' **0 of 20**. On 8 October 2026 Jim decided the recapture is intended:
the Node garrison, the home bonus and the combat table stand as they are, no rule changes, and —
because nothing about the resolution moved — **no series is replayed**. The Centre Node ping-pong
box in `salient/docs/salient-rules-v0.md` is ticked with that decision and these rates beside it.
Had the answer been a change to combat or to the Node garrison, every match of both runs would have
been replayed at its seeds: the rerun's 10 logs tracked under `series/marvin-subagent-vs-greedy/`
would have become the old baseline against a new series, and run 1's 8 counted matches, which exist
only as figures, would have stopped being comparable.

### No last-seen memory

The rules' question: the engine does not report what a player saw on earlier turns, so should
`get_state` show last-seen values? The test the brief sets is re-scouts per seat per match — a
seat that re-scouts the same hexes over and over is paying action points for memory the engine
could hand it. The rerun has the row.

| player | matches | scouts | re-scouts | distinct hexes | re-scouts a match |
| --- | ---: | ---: | ---: | ---: | ---: |
| bot:greedy | 10 | 0 | 0 | 0 | 0.00 |
| marvin/subagent | 10 | 75 | 17 | 58 | **1.70** |

That is a small tax. **17 of the model seat's 75 scouts were of a hex that seat had already
scouted** — 22.7% of them, 1.70 a match out of the 150 action points a seat carries in a match —
and it scouted **58 distinct hexes** over the ten matches, about 5.8 new hexes a match, so most of
its recon was looking at ground it had not looked at. Greedy scouted 0 times and won 8 of the 10,
which is the same fact run 1 showed: the information advantage in this pairing was not with the
seat that had the tools.

What the row cannot say is what a seat that keeps looking would pay. The seat's scout rate still
collapses with depth — **0.64 → 0.23 → 0.04 a turn**, 3 scouts in the last 80 turns — and this time
it is not the endpoint: it submitted on all 80 of those turns and ran 0.69 simulations a turn in
the same band, against 0.88 in turns 1-8. Run 1 read the same collapse (0.63 → 0.22 → 0.02) with 22
of its 64 late turns passed, so run 2 is the first time the shape of that curve is a choice the seat
made. A seat that stops asking cannot show what re-asking costs.

**Left open:** the figure that closes it is the re-scout share of a seat that keeps scouting late —
re-scouts per match against scouts per match, from a seat whose scouts per turn in turns
18-25 is at least its turns 9-17 rate (0.23 in the rerun, against 0.04 now). At 17 re-scouts in 75
scouts and 1.70 a match the rerun reads about one scout in four being re-bought, which is not the
pattern that would justify changing `get_state`; above half a seat's scouts being repeats, with
distinct hexes per match below the 5.8 it manages now, would be. That needs a second model seat,
not more matches of this one, whose late-game recon is too small to price. Adding
last-seen values to `get_state` changes what the model seat sees from turn 2 on, so all 10 rerun
matches would be played again at their seeds; Greedy's half of every pair would not change, since
it never scouted.

### Compaction

The rules' question: summarising the oldest context keeps a small-window model in the game but
changes what it remembers; the alternative is to let it fail when it runs out of room. Whether any
match of a real series compacts at all is answerable now, and the answer is yes — often, and
early.

**Run 1** recorded **7 compaction turns**, all on the model seat (Greedy: 0, it runs no
provider). They are spread over **all five seeds** — 572152369 turn 9, 708123 turn 13, 479473028
turn 15, 313966722 turns 15 and 20, 1003578858 turns 17 and 21 — so **at least 5 of the 8 counted
matches compacted at least once**. The report names seeds, not which match of a pair each turn
came from, so the exact number of matches is not recoverable from it. By band: **0 in turns 1-8, 5
in 9-17, 2 in 18-25**, the first on turn 9.

**Run 2 repeats it, and earlier:** **6 compaction turns**, again all on the model seat
(Greedy 0), over **4 of the 5 seeds** and **5 of the 10 matches** — 572152369 seat A turn 18,
708123 seat A turn 21, 479473028 seat A turn 17, 479473028 seat B turns 2 and 24, 313966722 seat B
turn 19 — by band **1 in turns 1-8, 1 in 9-17, 4 in 18-25**, the first on **turn 2**. The rerun's
report names the match each turn came from, which run 1's could not.

That expectation does not carry over to the series: seed 135 reached **94,659 of its
131,072 window (72.2%), growing 3,541 tokens a turn, and never compacted**, because Pi's threshold
is `contextWindow − 16,384 = 114,688`. Run 1's largest end-of-turn `context_tokens` is
**85,963**, below that threshold, yet it compacted seven times — because `context_tokens` is the
conversation sampled at the end of a turn while Pi's threshold check runs mid-turn over the
pending tool results ([series-notes §4](series-notes.md)). A series budget that assumes §7's
"never compacts" has it backwards: the mid-turn check is what fires compaction, and it fired
on every seed of run 1. Run 2's largest end-of-turn `context_tokens` is **114,038**, 650 tokens
under that same threshold, and it compacted six times — the same mid-turn check, on a seat that
ran far closer to its window than run 1's ever did.

The half of the question the series cannot answer is whether compaction turns carry worse play.
Run 1's depth split shows the errors rising late — provider_error passes **2 → 4 → 12**, turns
passed **15 → 16 → 22** — while tool errors *fall* **9 → 5 → 2** and rejected submissions stay flat
**7 → 4 → 6**. But the report splits by turn band, not by compaction turn, and the five
compactions in 9-17 sit in a band with only 4 provider errors, so nothing here attributes an
error to a compaction. That join needs the per-turn `compacted` flag against the per-turn error
counts, which is one pass over the logs — run 1's no longer exist, and run 2's are tracked under
`series/marvin-subagent-vs-greedy/`, so the join is now possible and still not made.

**Decision:** recommended, not taken — compaction stays on and the rules' alternative, let it
fail when it runs out of room, is refused on these numbers; Jim confirms it in brief §11. It is
not a hypothetical failure: run 1's seat lost **18 turns to provider errors** and **34 more to
the 300 s cap**, so 53 of its 200 turns were already lost to the harness, and removing the one
mechanism that keeps a 25-turn conversation inside its window would add to that count rather
than protect anything. Run 2 is the cleaner test of the same claim and points the same way: that
seat lost only **2 of its 250 turns** to the harness, and still compacted **6 times across 5 of
its 10 matches**, the first on turn 2 — compaction is what keeps a 25-turn conversation inside a
131,072-token window whether the endpoint is slow or fast. No engine or
config change, nothing to replay. The place this is answered is the brief §11 open item **"Whether
compaction stays on, after seeing how often it happens"** — how often it happens is now measured
twice (run 1: 7 turns, every seed, first on turn 9; run 2: 6 turns, 4 seeds, first on turn 2), so
the item can be answered. Until Jim answers it
there, the box in `salient/docs/salient-rules-v0.md` stays unticked and this line is a
recommendation with numbers under it, not a decision. What is still owed alongside it is the
attribution — compaction turns against error counts on those turns — which the rerun's tracked
logs now make possible.

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

Run 1 confirms the growth and corrects the budget. Tokens per turn on the model seat go
**48,090 → 100,376 → 110,548** across the depth bands, a 2.3× rise, with context means
16,800 → 43,076 → 59,398. But the match total is **2,172,486 tokens a match** (17,379,888 over 8),
less than half §7's single match, and the cache share — the thing that makes re-sending the
conversation affordable — fell to **14.2%–80.4% a match** against §7's 95.1%, because two seats
evicted each other's KV cache on one llama.cpp server at `--concurrency 1`
([series-notes §3](series-notes.md)). The cost of that is time, not money: 34 of 200 turns hit the
300 s cap and the run took **5 h 27 m 44 s** for five pairs, against §7's 18.8 minutes for one
match played alone. At the series' own 65.5 minutes a pair, a 150-match series is about 82
hours of Marvin, not §7's 48.

Run 2 measures the growth again, higher and with the cache working. Tokens per turn go **114,628 →
288,100 → 310,859** across the bands, a 2.7× rise, with context means 26,701 → 67,490 → 76,873 and
a match total of **5,996,793 tokens** (59,967,929 over the 10) — 2.8× run 1's 2,172,486 a match.
The cache share, the thing that makes re-sending the conversation affordable, is **98.3% of the
seat's prompt tokens** (58,125,343 cache-read of 59,109,607 prompt tokens; 96.9% of all its tokens
once output is counted), against run 1's 14.2%–80.4% a match and §7's 95.1%, both of which are the
same cache-read over prompt tokens — so the eviction penalty run 1 measured is not in the rerun.
Most of the higher total is more work per turn, not a worse cache: 3.57 tool calls a turn against
run 1's 2.35,
and 193 simulations against run 1's 51.

**Decision:** closed as measured, no rules change and nothing to replay. What it changes is the
budget, not the game: the brief §11 ceiling Jim set for this series, `--max-tokens 60000000`, was
not the binding constraint for run 1 — it spent 17,379,888 of it (29%) — and wall time
was, so run 1 sized the next series in hours against its measured 65.5 minutes a pair. Run 2
corrects that: it spent **59,967,929** of the same 60,000,000 ceiling, 99.9% of it, so a 10-pair
series at its 5,996,793 a match needs a ceiling near 120,000,000 or it stops on tokens rather than
on pairs. Its own wall time is not in its report; counted from the tracked logs, the ten
matches' per-turn `wall_ms` sum to about 2 h 31 m and their `created` stamps span 2 h 25 m — about
30 minutes a pair, less than half run 1's 65.5, which is what a clean run on an uncontented Marvin
looks like.

### Own-orientation boards

The rules' question: showing each player the board with its own Base on the same side would remove
seat bias at the source, but the renderer would then have to translate hex labels in intent text.

This is out of scope for v0 — brief §3 lists it among the things v0 does not build — and neither
run gives a reason to pull it in. The mechanism v0 does use, playing every pair twice, worked at
this length. **Run 1: seat A 0–4 and seat B 0–4, with identical 95% Wilson intervals of 0.0% –
49.0%**, and the report's own note that "A gap between them is the board, not the model, and
it is why every pair is played twice" describes a gap of exactly zero. **Run 2 repeats it: seat A
1–4 and seat B 1–4, identical intervals of 3.6% – 62.4%.** Two runs, two nil gaps — but five
matches a seat each is a weak confirmation, not a strong one, it cannot detect a modest seat
effect, and the two runs are not pooled across `749d236`.

What it would cost, if it were ever done: a per-seat transform of the board in `get_state` and the
prompt, hex-label translation in the renderer's intent and prediction text (both capped at 280
characters, and the model quotes hex labels in them), and a re-derivation of the
symmetry test, which currently hands each bot the board in its own orientation and draws on
300 maps. And every model match ever played would have to be replayed, because seat B saw the
board the other way round: run 1's 8 counted matches and its 2 voided ones, and run 2's 10.

**Decision:** stays out of scope for v0, exactly as brief §3 has it. No engine change, no replay,
nothing to propose to the next epic. Reopen it when a pairing is close enough that a seat effect
could decide a series — and measure the effect first with the seat-effect rows over 10+ pairs,
which costs nothing, before changing what every seat sees, which costs the whole series.

### Guessing check

The rules' question: if the Greedy bot beats a strong model often, simultaneous turns are too much
of a guessing game and the rules need more depth.

**Run 1**'s headline fires the trigger on its face: Greedy won **8 of 8**, the model's win rate is
**0.0% with a 95% Wilson interval of 0.0% – 32.4%**, the mean margin is **33.9 points (27.3 –
41.5)** on a 93-point board, and the seat split is nil, so it is not the board doing it.

The confounder is in the same report, and it is large. Of the model's 200 turns, **53 ended as
passes** — 34 at the 300 s turn cap, 18 provider errors, 1 no submission — and **17 submissions
were rejected** by the server, with 16 tool errors and 1 wasted order. Greedy passed 0 turns,
submitted 0 invalid sets, made 0 tool errors, and used 408 calls at 2.04 a turn. A seat that does
not act on a quarter of its turns is not losing to a guessing game; it is losing to a slow
endpoint and a 300-second clock, and the two voided matches are a further two of ten lost to a
tool-name slip rather than to any decision on the board. The interval itself says the sample is
thin: 0.0% – 32.4% is the width an 8-match series gives, and the adaptive stop never ran because
`MIN_TEST_PAIRS` is 10 pairs and run 1 had 5.

**One of those two was already fixed, three hours after run 1 finished.** Commit `749d236`
changed `packages/harness/src/pi-player.ts` so that a call to one of the seven by its bare name —
`submit_orders` for `mcp__salient__submit_orders`, which is what voided seeds 479473028 and
313966722 — is logged as a refused call and the turn carries on, instead of voiding the match for
`tool_surface`. The harness now voids on no tool name at all: Pi's lock-down refuses any tool the
seat was not given, and the call is logged as refused. A re-run should not lose matches this way,
and the rerun did not: of run 1's two confounders, only turn latency was still owed, and run 2
shows that one paid too.

That fix has a cost for the reading below it: **a re-run is played under a different
harness rule from run 1.** Run 1's 10 matches were played by a harness that voided a
bare-name call; the rerun's were played by one that does not, so they are not matches played under
identical conditions — the same comparability problem
[series-notes §5](series-notes.md) cites for changing nothing mid-series. It bites the reports'
own rows: run 1's two missing matches are `tool_surface` voids the new harness would not have made
for that reason, so the two reports' missing-match rows are not the same measurement, and the
rerun's interval is computed over its own 10 counted matches, none of which is one of run 1's 8.
Read the seat split and the missing-match rows of each report as belonging to that run alone.

**The rerun is the second sample, and it clears the confounder.** Greedy won **8 of 10**; the
model's win rate is **20.0% with a 95% Wilson interval of 5.7% – 51.0%**, the mean margin is
**18.5 (10.5 – 26.8)**, the seat split is nil again (1–4 in each seat), and there are no
knockouts. Of the model seat's 250 turns, **2 ended as passes** — both `no_submission`, both in
turns 1-8 — with **0 timeouts, 0 provider errors and 0 voided matches**, which is why the rerun
counted 10 of 10. What is left on that seat is 25 rejected submissions and 43 tool errors, 31 of
them in turns 1-8, and 2 wasted orders: it costs turns, not matches. The seat also played better — its
two wins came by margins of 2 and 6, and the mean margin against it fell from 33.9 to 18.5 — so the
pairing is closer than run 1's, but not close.

**Decision:** no change to the simultaneous-turn rules on this evidence, and nothing to replay.
The trigger is now read on a sample the harness has not wrecked, and it does not fire: the check is
Greedy above 50% **with the interval excluding 50%**, and the rerun's interval on the model seat
runs to **51.0%** — the mirror interval on Greedy's 8 wins in 10 is 49.0% – 94.3%, which includes
50%. Eight wins in ten is as much as a 5-pair series can say, and the interval test never ran
because `MIN_TEST_PAIRS` is 10 pairs and the rerun had 5. The figure that files the depth question
is a 10-pair series of this pairing in which the model seat's upper Wilson bound falls below 50%
— the rerun misses it by 1.0 point on 10 matches — and if that happens, the depth change goes to
the next epic as an engine question and every match in the series is replayed at its seeds.

---

## What is still outstanding after the rerun

The rerun put the five counters in the repository, so what is open is no longer "the measurement
does not exist". Three things are.

1. **A longer series.** The rerun is 5 pairs / 10 matches and stopped on `max_pairs`, so the
   interval test never ran: `MIN_TEST_PAIRS` is 10 pairs (`packages/runner/src/series-stop.ts`).
   Its `series.json` and its ten logs are tracked under `series/marvin-subagent-vs-greedy/`, so the
   same command at `--max-pairs 10` **resumes that series** — `planSeries` reads the five played
   pairs back from their logs and skips them, and draws five more from the same `seed_base` — and
   the interval test then runs over 20 matches:

   ```bash
   no-dice series --game salient --a marvin/subagent --b bot:greedy \
     --name marvin-subagent-vs-greedy --max-pairs 10 --max-tokens 120000000 --concurrency 1
   no-dice evidence --series series/marvin-subagent-vs-greedy
   ```

   with both generated files copied into `reports/series/` again, which is what
   `scripts/kept-series-evidence.test.mjs` now checks against the tracked logs. `--max-tokens` has
   to move: the rerun spent **59,967,929** of the 60,000,000 ceiling both runs ran under, 99.9% of
   it, so 20 matches at its 5,996,793 a match stops on tokens instead of pairs. The five pairs it
   still has to play are about 5.5 more hours of Marvin at run 1's measured 65.5 minutes a pair;
   counted from the rerun's own logs it ran nearer 30 minutes a pair, so budget the afternoon
   rather than the day.

2. **A second and more competitive pairing.** Every rerun counter came from one pairing, and in it
   Greedy won 8 of the 10 matches, only 3 of the 10 matches changed the lead, and the bot-vs-bot
   counters kept beside them read 0.00 lead changes a match — themselves partly a knockout artifact,
   since 5 of those 10 bot matches ended before turn 25. That is enough to read quietness and
   not enough to read a rule. The Home bonus section's lead-change row and the Guessing check's
   depth trigger both need a pairing that changes the lead in about half its matches — a second
   model seat, or Greedy against a scripted bot that plays for the Node — and the No last-seen
   memory section needs a seat whose scout rate does not fall to 0.04 a turn in turns 18-25.

3. **Whether the rerun's own passes and provider errors still swamp the comparison: they do not.**
   Run 1's late-turn figures could not be read for play, because 53 of its 200 model turns were
   passes — 34 at the 300 s cap, 18 provider errors, 1 no submission — and 2 matches were voided.
   The rerun's seat lost **2 of its 250 turns**, both `no_submission` and both in turns 1-8, with
   **0 timeouts and 0 provider errors**, and 10 of 10 matches counted. What still sits on that seat
   is 25 rejected submissions and 43 tool errors, 31 of them in turns 1-8, and 2 wasted orders: it
   costs turns, not matches, and it is heaviest in the opening. So the rerun's counters are read as
   play throughout this file, with one exception — the 31 early tool errors are why the turns 1-8
   bands are quoted for shape and not relied on for size.

Two engine questions were deferred in prose above with no task filed behind them, and the rerun
settles one of them. **The ping-pong flag fired** — 1 of 10 counted matches, seed 313966722, hex
E5, turns 5, 19, 20 — so the question whether attacking a Node with the exact minimum is meant to
be rewarded was filed, as the proposed task *"The engine's minimum-force attack on a Node is
measured, and the ping-pong it allows is decided"*, and that task has now been played: the attack
and the consecutive recapture are pinned by `games/salient/engine/src/node-ping-pong.test.ts`, the
Greedy-vs-Greedy series put **0 of 20** beside the rerun's 1 of 10, and the Centre Node ping-pong
section carries both. **The depth question is still not filed, and this paragraph is the marker that it is owed one:**
its trigger is Greedy above 50% with the interval excluding 50%, the rerun's interval on the model
seat runs to 51.0%, so it did not fire. A 10-pair series that puts that upper bound under 50%
files it.
