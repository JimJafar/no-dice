---
id: series-stop
title: The series stops when the result is clear, at its pair limit, or at its ceiling
milestone: 04-series-runner-and-stats
depends_on: [series-run, stats-wilson-margin]
---

Give `runSeries` its stopping rules, in `packages/runner/src/series-stop.ts` beside the loop.
Brief §6.5: matches are played in **batches of 5 pairs**; after each batch, **from 10 pairs
on**, compute the **99% Wilson interval** for model X's win rate with a draw counting half a
win, using `wilsonInterval` and the win-rate helper from `@no-dice/stats` — not a copy in the
runner, since the report quotes the same interval at 95% and the two must not drift. Stop when
that interval excludes 50%. Otherwise stop at `--max-pairs`, default **75** (150 matches). The
99% figure is deliberate and stricter than the report's 95% because the test is applied after
every batch; say so in the code comment and record in `series.json` which interval decided it,
the interval itself, and `stopped_early`.

Then the cost guard. `--max-cost <usd>` is brief §6.5's, and it needs a sibling: the one real
match measured so far (`docs/pi-harness-notes.md` §7) costs `cost_usd: 0` on every turn
because Jim's Marvin server is unpriced hardware, while it burns **4.59M tokens and 19 minutes
of seat time**, which makes a 150-match series roughly **688M tokens and 48 hours**. So the
ceiling that actually protects a run is a token ceiling: add `--max-tokens <n>` summing
input + output + cache-read + cache-write across the matches played, and stop at the next
batch boundary when either ceiling is passed, recording which one and the totals at that
point. Never stop in the middle of a pair.

## Acceptance
- [ ] Scripted results of 18 wins in the first 20 matches stop the series at 10 pairs, and
      `series.json` says it stopped early with the 99% interval that decided it (brief §8)
- [ ] Scripted alternating wins run to `--max-pairs`, and `series.json` says it did not stop
      early
- [ ] A scripted run whose summed cost or tokens pass `--max-cost` / `--max-tokens` stop at the
      next batch boundary, name the ceiling that fired, and never split a pair

## Verification
```bash
pnpm test -- series-stop
```
