---
id: management-ui-leaderboard-rows
title: The stats package pools a leaderboard out of the reports it already makes
milestone: 08-ui-providers-and-leaderboard
depends_on: []
---

The leaderboard's arithmetic, in the one package allowed to have any. Two changes, no new
formula anywhere.

**Per-model results in a series report.** `seriesReport` already groups the counted matches by
the label each seat's log header carries (`playerLabel`, which spells a model seat
`<provider>/<id>` and a bot seat `bot:<name>` — the same spelling `seatLabel` uses, which is what
lets the same model be pooled across series). Its `SeatScope` carries the seat that model held
but not how the match went, so add the outcome — `outcomeOf(match.result, seatThatModelHeld)`,
computed once where the counted matches are already being walked — and give `ModelRow`
two fields: `result: ResultRow` (that model's win rate with the report's 95% Wilson interval,
from the same `resultOf` the report uses for model X) and `seatSplit: Record<Seat, ResultRow>`
(the same counts over only the matches that model played from each seat). `renderSeriesReportMarkdown`
is **not** changed: its output is pinned by `stats-series-report` and by the reports already on
disk, and the leaderboard reads the object, not the markdown.

**Pooling.** New `packages/stats/src/leaderboard.ts`, exported from `packages/stats` as
`./leaderboard`, with `pooledModelRows(reports: SeriesReport[]): PooledModelRow[]`. For each
model label appearing in any report it sums that label's `matches`, `seats`, and
`result.winRate`'s wins/losses/draws across the reports, then runs the pooled totals through
`winRateOf` and `wilsonInterval({ successes, n, z: zOf(REPORT_CONFIDENCE) })` — the same two
functions the report and the stopping test use, so a pooled interval is a Wilson interval over
the pooled `n` and nothing else. Each row carries `label`, `matches`, `seats`, `result`,
`seatSplit`, `missing` and `series` (the directory names it came from), sorted by pooled win rate
descending and then by label, so the same disk gives the same table. A model with no counted
match has no row: a rate of `null` over nothing is not a leaderboard entry.

**What `missing` means here, and why it is not a win or a loss.** A missing match has no log, so
it has no header to attribute it to; the series record attributes it to a *pairing*. A pooled row
therefore counts, for a model, the missing matches of every series under the root whose
pairing names that model — the match was denied to both of its seats, so it is missing for both.
That is the same rule `series-report.ts` already applies (failed, voided, missing log, unreadable
log are *missing*, never a loss), and the row has to say in words that it is an attribution
to the pairing rather than a count of matches this model failed to play.

The per-pairing view needs no new code: `seriesReport` already answers it, and
`packages/ui/src/results.ts` already turns it into rows.

## Acceptance
- [ ] `seriesReport`'s per-model rows carry that model's win rate with its 95% interval and its
      seat split, computed with `outcomeOf`, `winRateOf` and `wilsonInterval` and nothing else,
      and `renderSeriesReportMarkdown`'s output is unchanged
- [ ] `pooledModelRows` over two series gives one row per model label whose counted matches,
      wins, losses and draws are the sums of those reports', with the interval recomputed over
      the pooled match count
- [ ] Pooled over a single series, a model's row equals that series' own report figures for it,
      and a model's `missing` is the missing count of the series whose pairing names it

## Verification
```bash
pnpm test -- leaderboard series-report
rm -rf /tmp/nd-lb-rows && mkdir -p /tmp/nd-lb-rows
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:random --max-pairs 2 \
  --dir /tmp/nd-lb-rows/g-vs-r > /dev/null
node packages/runner/src/cli.ts series --game salient --a bot:random --b bot:greedy --max-pairs 1 \
  --dir /tmp/nd-lb-rows/r-vs-g > /dev/null
node --input-type=module -e '
const { seriesReport } = await import("./packages/stats/src/series-report.ts");
const { pooledModelRows } = await import("./packages/stats/src/leaderboard.ts");
const reports = await Promise.all(["/tmp/nd-lb-rows/g-vs-r", "/tmp/nd-lb-rows/r-vs-g"].map((dir) => seriesReport(dir)));
const pooled = pooledModelRows(reports);
const labels = [...new Set(reports.flatMap((r) => r.models.map((m) => m.label)))];
if (pooled.length !== labels.length) throw new Error("one row per model label, got " + String(pooled.length));
for (const row of pooled) {
  const parts = reports.map((r) => r.models.find((m) => m.label === row.label)).filter((m) => m !== undefined);
  const sum = (pick) => parts.reduce((total, part) => total + pick(part), 0);
  if (row.matches !== sum((m) => m.matches)) throw new Error(row.label + ": counted matches did not pool");
  for (const key of ["wins", "losses", "draws"]) {
    if (row.result.winRate[key] !== sum((m) => m.result.winRate[key])) throw new Error(row.label + ": " + key + " did not pool");
  }
  if (row.seats.A !== sum((m) => m.seats.A) || row.seats.B !== sum((m) => m.seats.B)) throw new Error(row.label + ": the seat split did not pool");
  if (row.seats.A + row.seats.B !== row.matches) throw new Error(row.label + ": the seat split does not add up to the matches");
  const missing = reports.filter((r) => r.models.some((m) => m.label === row.label)).reduce((total, r) => total + r.missing.total, 0);
  if (row.missing !== missing) throw new Error(row.label + ": missing did not pool the series that pairing names");
  const rate = row.result.winRate;
  if (rate.n !== row.matches || rate.rate === null) throw new Error(row.label + ": the rate is not over the counted matches");
  if (row.result.interval === null || row.result.interval.low > rate.rate || rate.rate > row.result.interval.high) throw new Error(row.label + ": the rate is outside its own interval");
}
const single = pooledModelRows([reports[0]]);
const x = reports[0].result;
const greedy = single.find((row) => row.label === reports[0].xLabel);
if (!greedy) throw new Error("model X has no row of its own");
if (greedy.result.winRate.rate !== x.winRate.rate || greedy.result.interval.low !== x.interval.low || greedy.result.interval.high !== x.interval.high) {
  throw new Error("pooled over one series the row is not that report figure");
}
if (greedy.seatSplit.A.winRate.rate !== reports[0].seatSplit.A.winRate.rate) throw new Error("the seat split is not the report seat split");
'
grep -q '"./leaderboard"' packages/stats/package.json
```
