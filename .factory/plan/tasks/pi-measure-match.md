---
id: pi-measure-match
title: One real match is played and its cost per turn is measured
milestone: 03-pi-harness
depends_on: [pi-long-match-checks]
---

Play the match this milestone exists for: one of Jim's models against the Greedy bot, 25
turns, one seed, and report what it really costs. Add `scripts/measure-match.mjs` — an
operator script, not a shipped `no-dice` subcommand — that runs the match through the runner,
then prints a per-turn table of input, output, cache-read and cache-write tokens, cost,
context size, wall time and tool calls, with the match totals underneath, and writes the same
table to the path `--out` names (by convention `reports/pi-cost-<model>-<seed>.md`) beside
the log. Take a `--max-cost` guard that
stops the match when the running cost passes it, which is the cheap forerunner of the series
guard in brief §6.5. These are the numbers brief §10 and §11 wait on: the per-turn
output-token budget, the cost ceiling for the first series, and whether context growth fits a
200,000-token window or compaction has to be re-decided. Finish the provider-dependent lines of
the first-run checklist in `docs/pi-harness-notes.md` while the run is in front of you —
whether `tokens.cacheRead` is non-zero for the provider under test, and whether the MCP
connection and the lock-down held against a real model rather than the stub.

This task cannot start until Jim gives the model IDs, the provider and the API key environment
variables (brief §11). Run one match, not a series: a series is milestone 04's, and the point
here is to learn the price before paying it 150 times.

## Acceptance
- [ ] A full model-versus-Greedy match is played and its log validates against `salient-log/1`
- [ ] The report gives tokens, cost and context size for every turn and totals for the match,
      and states the cost of one match
- [ ] `docs/pi-harness-notes.md` records whether cache reads and the tool lock-down held for
      the real provider

## Verification
```bash
# needs NO_DICE_MODEL=<provider>/<model-id> and that provider's API key in the environment
node scripts/measure-match.mjs --model "$NO_DICE_MODEL" --seed 135 --out reports/pi-cost.md
node -e '
const rows = require("node:fs").readFileSync("reports/pi-cost.md", "utf8").split("\n");
const turns = rows.filter((r) => /^\|\s*[0-9]+\s*\|/.test(r));
if (turns.length < 25) throw new Error(`only ${String(turns.length)} turn rows`);
if (!rows.some((r) => /cache/i.test(r))) throw new Error("no cache columns");
'
```
