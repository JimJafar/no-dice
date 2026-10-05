---
id: series-real-run
title: The first real series is played and its report is kept
milestone: 06-first-real-series
depends_on: [runner-provider-registry]
---

Run the match series this project exists to measure. Jim settled the first pairing and the
ceiling: **`marvin/subagent` against the Greedy bot, keyless, 5 pairs, a 60,000,000-token
ceiling, concurrency 1**. The second model comes later, and a second pairing is the same command
with a different `--name` and `--a`.

```bash
no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 5 --max-tokens 60000000 --concurrency 1
```

What that costs, from `docs/pi-harness-notes.md` §7: one `marvin/subagent` seat is **4.59M tokens
and 19 minutes of seat time**, and a match has one Pi seat (the other seat is the bot), so 10
matches is roughly **46M tokens and 3-4 hours end to end at concurrency 1**. The 60M ceiling
therefore sits above the pair limit and is there to stop a runaway, not to end the run: expect
`stop.reason: max_pairs`. The adaptive stop only applies from 10 pairs (`MIN_TEST_PAIRS` in
`packages/runner/src/series-stop.ts`), so this series reports that it played its full length
rather than stopping early, and the report says which happened. `cost_usd` is 0 throughout on
Marvin because it is Jim's own unpriced hardware, which is why `--max-tokens` and not
`--max-cost` is the guard here. Concurrency stays at 1 as Jim asked: `--concurrency` bounds
*pairs*, so 1 is one match and two seats at a time on one llama.cpp server, and §7 found the
turns that missed the prompt cache were the slowest turns of the match.

Resume, do not restart: the same command replays nothing that already has a log
(`packages/runner/src/series-plan.ts`), and `series.json` is rewritten atomically after every
batch of 5 pairs. A run this long will be interrupted — start it, let it play, and run the same
command again if it dies; a resumed run continues from its recorded seed list. A first run of 5
pairs is not a throwaway: raising `--max-pairs` later continues the same series. Expect missing matches: `docs/pi-harness-notes.md` §7's first
Marvin attempt was voided on turn 3 because the seat called `simulate` instead of
`mcp__salient__simulate`, and `games/salient/prompts/player-system.md` never names the seven
tools. Report how many matches the series lost and why — the report already separates them from
the win rate — but do **not** change the prompt or the rules mid-series: it would make the
matches in one series incomparable.

`series/` is gitignored and a real log is ~1 MB of tool results, so what the repository keeps is
the report: copy `series/marvin-subagent-vs-greedy/report.md` to
`reports/series/marvin-subagent-vs-greedy.md` (only
`reports/*.json` is ignored, so the markdown commits) and write `docs/series-notes.md` with the
exact command, the ceiling, the concurrency, the wall time, how many matches went missing, and
how to resume it.

## Acceptance
- [ ] A series of 5 seat-swapped pairs of `marvin/subagent` against Greedy is played under the
      60M token ceiling, and its `series.json` records the pairing, the seed list and the stop
      reason
- [ ] `reports/series/marvin-subagent-vs-greedy.md` is committed and carries the win rate with
      its 95% interval, the seat split, the margin interval and how many matches were missing
      and why
- [ ] `docs/series-notes.md` records the command, the ceiling, the concurrency and the wall time
      well enough for the same series to be resumed and repeated

## Verification
```bash
node -e '
const fs = require("node:fs");
if (!fs.existsSync("docs/series-notes.md")) throw new Error("docs/series-notes.md is not there");
const path = "reports/series/marvin-subagent-vs-greedy.md";
if (!fs.existsSync(path)) throw new Error(`${path} is not there`);
const text = fs.readFileSync(path, "utf8");
for (const need of [/marvin\/subagent/, /win rate/i, /95%/, /seat/i, /stopped/i, /missing/i]) {
  if (!need.test(text)) throw new Error(`${path} says nothing about ${need}`);
}
'
```
