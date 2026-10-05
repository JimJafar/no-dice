---
id: series-real-run
title: The first real series is played and its report is kept
milestone: 06-first-real-series
depends_on: [runner-provider-registry]
---

Run the match series this project exists to measure: a named model against the Greedy bot,
seat-swapped pairs, under a ceiling, and keep the report.

```bash
no-dice series --game salient --a <provider>/<model-id> --b bot:greedy \
  --name <pairing> --max-pairs <n> --max-tokens <ceiling> --concurrency <k>
```

Facts the run has to be planned against, all measured in `docs/pi-harness-notes.md` §7: one
`marvin/subagent` seat is **4.59M tokens and 19 minutes of seat time**, so brief §6.5's default
150 matches is ~688M tokens and ~48 hours end to end at concurrency 1. On Marvin `cost_usd` is
0 on every turn because it is Jim's own unpriced hardware, so **`--max-tokens` is the ceiling
that actually binds** and `--max-cost` guards a priced provider only. `--concurrency` bounds
*pairs*, so `k` pairs is up to `2k` matches and `4k` Pi seats; on one llama.cpp server more
seats means more KV-cache eviction, and §7 found the five turns that missed the prompt cache
were the five slowest turns of the match — so start at the concurrency Jim's hardware takes
comfortably and record what it was. The adaptive stop only applies from 10 pairs
(`MIN_TEST_PAIRS` in `packages/runner/src/series-stop.ts`), so a shorter run reports that it
played its full length rather than stopping early; that is expected, and the report says which
happened.

Start small and resume: the same command replays nothing that already has a log
(`packages/runner/src/series-plan.ts`), so a first run of a few pairs is not a wasted one — it
is the beginning of the series. Expect missing matches: `docs/pi-harness-notes.md` §7's first
Marvin attempt was voided on turn 3 because the seat called `simulate` instead of
`mcp__salient__simulate`, and `games/salient/prompts/player-system.md` never names the seven
tools. Report how many matches the series lost and why — the report already separates them from
the win rate — but do **not** change the prompt or the rules mid-series: it would make the
matches in one series incomparable.

`series/` is gitignored and a real log is ~1 MB of tool results, so what the repository keeps is
the report: copy `series/<name>/report.md` to `reports/series/<pairing>.md` (only
`reports/*.json` is ignored, so the markdown commits) and write `docs/series-notes.md` with the
exact command, the ceiling, the concurrency, the wall time, how many matches went missing, and
how to resume it.

## Acceptance
- [ ] A series of at least a few seat-swapped pairs of the named model against Greedy is played
      under a ceiling, and its `series.json` records the pairing, the seed list and the stop
      reason
- [ ] `reports/series/<pairing>.md` is committed and carries the win rate with its 95% interval,
      the seat split, the margin interval and how many matches were missing and why
- [ ] `docs/series-notes.md` records the command, the ceiling, the concurrency and the wall time
      well enough for the same series to be resumed and repeated

## Verification
```bash
node -e '
const fs = require("node:fs");
const dir = "reports/series";
if (!fs.existsSync("docs/series-notes.md")) throw new Error("docs/series-notes.md is not there");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
if (files.length === 0) throw new Error("no committed series report under reports/series");
const text = fs.readFileSync(`${dir}/${files[0]}`, "utf8");
for (const need of [/win rate/i, /95%/, /seat/i, /stopped/i, /missing/i]) {
  if (!need.test(text)) throw new Error(`${dir}/${files[0]} says nothing about ${need}`);
}
'
```
