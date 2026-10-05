---
id: stats-series-report
title: A finished series gets its report
milestone: 04-series-runner-and-stats
depends_on: [stats-match-metrics, stats-wilson-margin, series-run]
---

Add `packages/stats/src/series-report.ts`: take a series directory, read its `series.json`
and every match log it names, and produce brief §6.7's report for the pairing — as a
structured object and as markdown written to `series/<name>/report.md`. It reads the log
format and nothing else: no engine, no server, no Pi.

The rows: wins, losses and draws for model X and its win rate with a **95% Wilson interval**
(a draw half a win) beside the `stopped_early` flag and the 99% interval the series stopped
on, so a reader can see the test that ended the run; mean margin with its bootstrap interval,
knockouts counted as 93; the knockout count and the turns they happened on; per model the
rows `match-metrics` produces, with the turns 1-8 / 9-17 / 18-25 split aggregated across the
series' matches; and the **seat split** — X's results in seat A against seat B — which is the
check that the seat swap cancelled the board. Report matches that failed or were voided as
missing rather than folding them into the win rate, and say how many there are: a series that
lost 10 of 150 matches to `tool_surface` (the first Marvin attempt did, `docs/pi-harness-notes.md`
§7) has to say so on its face.

Leave showcase selection (brief §6.7's "which match to render") out: it belongs to milestone
06, once there is a real series to pick from.

## Acceptance
- [ ] A series directory yields win/loss/draw counts, the win rate with its 95% Wilson interval
      and the seat split, and states whether the series stopped early
- [ ] Mean margin carries a bootstrap interval, knockouts count as 93, and the knockouts are
      listed with the turns they happened on
- [ ] Per-model rows include the turns 1-8 / 9-17 / 18-25 split, and failed or voided matches
      are counted separately from the win rate

## Verification
```bash
pnpm test -- series-report
```
