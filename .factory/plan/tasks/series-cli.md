---
id: series-cli
title: no-dice series and no-dice stats run from the command line
milestone: 04-series-runner-and-stats
depends_on: [series-stop, series-concurrency, stats-series-report]
---

Extend the CLI with the second command brief §1 asks for. `packages/runner/src/args.ts` was
built for this — it already says milestone 04's flags sit beside `match`'s — so add a `series`
command taking `--game --a --b` (the same seat specs as `match`: `bot:random`, `bot:greedy`,
`<provider>/<model-id>`) plus `--max-pairs <n>` (default 75), `--max-cost <usd>`,
`--max-tokens <n>`, `--concurrency <n>` (default 1), `--seed-base <n>` and `--name <name>` /
`--dir <path>` (default `series/<a-slug>-vs-<b-slug>`, built with the existing `seatSlug`), and
a `stats` command taking `--series <dir>`. Keep the parser's existing discipline: unknown flag,
missing value, a non-integer `--max-pairs` or `--concurrency`, a negative ceiling each exit
non-zero with one line naming exactly what is wrong, and `match`'s behaviour and its tests do
not move.

`runCli` then drives `runSeries` and `renderSeriesReport`, printing one line per pair as it
goes (seed, seats, result, running win rate and interval) so an operator watching a 48-hour run
knows where it is, and finishing with the stop reason, the win rate with its 95% interval, and
the paths of `series.json` and `report.md`. A model seat with no credential is still reported
in one line before a turn is played, as `match` does. Keep `runCli` returning its exit code
rather than calling `process.exit`, which is what lets the existing tests drive a real run.

## Acceptance
- [ ] `no-dice series --game salient --a bot:greedy --b bot:random --max-pairs 2 --dir <dir>`
      plays the 2 seat-swapped pairs, writes their logs and `series.json`, and prints the stop
      reason and the report path
- [ ] Running the same command again plays nothing already on disk and exits 0
- [ ] An unknown flag, a non-integer `--max-pairs` and a missing `--b` each exit non-zero with
      a message naming the problem, and `no-dice stats --series <dir>` prints the report

## Verification
```bash
pnpm test -- cli
rm -rf /tmp/nd-series
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:random --max-pairs 2 --dir /tmp/nd-series
test "$(ls /tmp/nd-series/matches/*.json | wc -l)" -eq 4
test -f /tmp/nd-series/series.json && test -f /tmp/nd-series/report.md
node packages/runner/src/cli.ts stats --series /tmp/nd-series
```
